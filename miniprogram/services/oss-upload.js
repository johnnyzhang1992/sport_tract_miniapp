/**
 * 照片上传（决策 D12：后端 AK 签名直传，无需 STS/RAM 角色）
 * 流程（2026-09-21 起）：合规检测 → OSS 直传，检测与上传各用一份压缩副本：
 * - 检测副本：从 q50 起逐档下探，压进 1MB（微信 imgSecCheck 硬限）才送检
 * - 存档副本：检测通过后按 q80 从本地原图重压一份直传（画质与检测副本解耦）
 * - 检测违规：拒绝上传（返回 { blocked: true }）
 * - 检测副本压不进 1MB：返回 { tooLarge: true, sizeBytes }（调用方提示具体大小）
 * - 微信检测未配置/异常（skipped）：降级放行（本地联调不阻塞）
 * - OSS 未配置：返回 null（打点不带照片）
 */
const api = require('./api');

/** 合规检测单图硬上限：1MB（imgSecCheck 要求，后端 /users/check-image 同步校验） */
const CHECK_MAX_BYTES = 1024 * 1024;
/** 检测副本质量档位：优先 q50，压不进 1MB 再逐档下探（只影响检测副本，不影响存档画质） */
const CHECK_QUALITIES = [50, 35, 25];
/** 存档副本质量：检测通过后按此质量重压再传 OSS */
const UPLOAD_QUALITY = 80;

function extOf(path) {
  const m = /\.(\w+)$/.exec(path || '');
  return m ? m[1].toLowerCase() : 'jpg';
}

/** 压缩到指定质量；失败/格式不支持时原样返回（不阻断流程） */
function compressTo(src, quality) {
  return new Promise((resolve) => {
    wx.compressImage({ src, quality, success: (r) => resolve(r.tempFilePath), fail: () => resolve(src) });
  });
}

/** 本地文件大小（字节）；取不到回 0（视为未知，交给服务端兜底判定） */
function fileSize(filePath) {
  return new Promise((resolve) => {
    wx.getFileInfo({ filePath, success: (r) => resolve(r.size || 0), fail: () => resolve(0) });
  });
}

/** 压出合规检测副本：q50 起逐档下探，取最小且 ≤1MB 者；压缩不支持时提前结束不空转 */
async function compressForCheck(src) {
  let best = { path: src, size: await fileSize(src) };
  for (const quality of CHECK_QUALITIES) {
    if (best.size > 0 && best.size <= CHECK_MAX_BYTES) break;
    const out = await compressTo(src, quality);
    if (out === src) break; // 压缩不可用（如部分格式）→ 再降档也无意义
    const size = await fileSize(out);
    if (size > 0 && (best.size === 0 || size < best.size)) best = { path: out, size };
  }
  return best;
}

/** 微信原生图片编辑（裁剪/涂鸦/文字/马赛克）；取消或不可用返回 null */
function editImage(src) {
  return new Promise((resolve) => {
    if (typeof wx.editImage !== 'function') return resolve(null);
    wx.editImage({
      src,
      success: (r) => resolve(r.tempFilePath || null),
      fail: (e) => {
        const msg = String((e && e.errMsg) || '');
        if (!msg.includes('cancel')) console.warn('[image] 编辑不可用:', msg);
        resolve(null);
      },
    });
  });
}

/**
 * 上传本地临时文件到 OSS（wx.chooseMedia / wx.editImage 的产物照常走此链）
 * @param {string} tempFilePath 本地临时路径
 * @param {object} [opts] { dir: OSS 子目录（默认 markers）, prefix: 文件名前缀（默认 marker_） }
 * @returns {Promise<{url: string} | {blocked: true} | {tooLarge: true, sizeBytes: number} | null>}
 *   - { url } 上传成功
 *   - { blocked: true } 违规被拦截（调用方提示用户）
 *   - { tooLarge: true } 检测副本压不进 1MB（调用方按 sizeBytes 提示具体大小）
 *   - null 降级（未配置）
 */
async function uploadPhoto(tempFilePath, opts = {}) {
  try {
    const dir = opts.dir || 'markers';
    const prefix = opts.prefix || 'marker_';

    // 1. 合规检测（imgSecCheck 硬限 1MB）：先压出检测副本再送检
    const checkFile = await compressForCheck(tempFilePath);
    if (checkFile.size > CHECK_MAX_BYTES) return { tooLarge: true, sizeBytes: checkFile.size };
    const sec = await api.checkImage(checkFile.path);
    if (sec.risky) {
      return { blocked: true };
    }

    // 2. 拿签名凭证（OSS 未配置时后端 503 → 降级 null）
    const creds = await api.post('/oss/credential', { dir });
    const filename = `${prefix}${Date.now()}_${Math.floor(Math.random() * 10000)}.${extOf(tempFilePath)}`;
    const key = `${creds.dir}${filename}`;
    const base = creds.endpoint.replace(/\/$/, '');
    const url = `${base}/${key}`;

    // 3. 存档副本按 q80 从本地原图重压（检测副本只送检不入库），签名直传；
    //    OSS PostObject：必须 POST 到 bucket 根路径，key 放 formData（带对象路径会返回 405 Method Not Allowed）
    const uploadPath = await compressTo(tempFilePath, UPLOAD_QUALITY);
    const res = await new Promise((resolve, reject) => {
      wx.uploadFile({
        url: `${base}/`,
        filePath: uploadPath,
        name: 'file',
        formData: {
          key,
          policy: creds.policy,
          OSSAccessKeyId: creds.OSSAccessKeyId,
          signature: creds.signature,
          success_action_status: '200',
        },
        success: (r) => resolve(r),
        fail: (e) => reject(e),
      });
    });

    if (res.statusCode === 200) return { url };
    console.warn('[oss] 直传失败', res.statusCode, String(res.data).slice(0, 200));
    return null;
  } catch (e) {
    console.warn('[oss] 上传跳过（OSS 未配置或失败）:', e.message);
    return null;
  }
}

module.exports = { uploadPhoto, editImage };

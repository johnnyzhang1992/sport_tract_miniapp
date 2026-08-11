/**
 * 照片直传 OSS（决策 D12：后端 AK 签名直传，无需 STS/RAM 角色）
 * 流程：微信合规检测（imgSecCheck）→ 后端签发签名凭证 → wx.uploadFile 直传
 * - 检测违规：拒绝上传（返回 { blocked: true }）
 * - 微信检测未配置/异常（skipped）：降级放行（本地联调不阻塞）
 * - OSS 未配置：返回 null（打点不带照片）
 */
const api = require('./api');

function extOf(path) {
  const m = /\.(\w+)$/.exec(path || '');
  return m ? m[1].toLowerCase() : 'jpg';
}

/**
 * 上传临时文件到 OSS（含合规检测）
 * @param {string} tempFilePath wx.chooseMedia 返回的临时路径
 * @returns {Promise<{url: string} | {blocked: true} | null>}
 *   - { url } 上传成功
 *   - { blocked: true } 违规被拦截（调用方提示用户）
 *   - null 降级（未配置）
 */
async function uploadPhoto(tempFilePath) {
  try {
    // 1. 微信内容安全检测（图片 ≤1MB；违规拒绝上传）
    const sec = await api.checkImage(tempFilePath);
    if (sec.risky) {
      return { blocked: true };
    }

    // 2. 拿签名凭证（OSS 未配置时后端 503 → 降级 null）
    const creds = await api.post('/oss/credential', { dir: 'markers' });
    const filename = `marker_${Date.now()}_${Math.floor(Math.random() * 10000)}.${extOf(tempFilePath)}`;
    const key = `${creds.dir}${filename}`;
    const base = creds.endpoint.replace(/\/$/, '');
    const url = `${base}/${key}`;

    // 3. 签名直传
    const res = await new Promise((resolve, reject) => {
      wx.uploadFile({
        url: `${base}/${key}`,
        filePath: tempFilePath,
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

module.exports = { uploadPhoto };

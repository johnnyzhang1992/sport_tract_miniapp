const config = require('../config/index');
const { getToken } = require('../services/storage');

/**
 * 运动数据导出（2026-11-01）：
 * - 汇总 CSV：/activities/export/summary（本人已完成活动，不含坐标明细与照片）
 * - 批量 GPX：/activities/export/gpx?ids=a,b,c（多条轨迹打包 zip，与单条导出同一 WGS-84 口径）
 * 下载链路与 track-detail 单条导出同款：wx.request(arraybuffer) → FileSystemManager 写
 * USER_DATA_PATH → wx.shareFileMessage（文件传输助手 → 电脑）。走 request 合法域名，
 * 不需要 downloadFile 域名白名单。二进制/文本统一 arraybuffer，落盘不挑编码。
 */

/** 单次批量 GPX 上限（与后端 EXPORT_GPX_MAX_ITEMS 一致，超限前端先拦，不发无效请求） */
const GPX_MAX_ITEMS = 100;

/** 导出范围（两张卡共用）：自定义需要同时给开始/结束日期 */
const EXPORT_RANGES = [
  { key: 'all', label: '全部记录' },
  { key: '30d', label: '近 30 天', days: 30 },
  { key: '90d', label: '近 90 天', days: 90 },
  { key: 'custom', label: '自定义' },
];

/** 'YYYY-MM-DD' → 东八区当天 00:00:00.000 / 23:59:59.999 的 ms；非法日期返回 null */
function parseExportDate(text, endOfDay) {
  const m = String(text || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const start = Date.UTC(y, mo - 1, d) - 8 * 3600000;
  const check = new Date(start + 8 * 3600000);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() + 1 !== mo || check.getUTCDate() !== d) return null;
  return endOfDay ? start + 86400000 - 1 : start;
}

/**
 * 纯函数：范围档 + 自定义日期 → {from,to}（ms）。
 * 固定档沿用 CSV 原来的「滚动窗口」口径；自定义按东八区自然日、结束日含当天。
 * 非法输入抛带中文提示的 Error，调用方直接 toast。
 */
function rangeParams(rangeKey, startDate, endDate, now = Date.now()) {
  const range = EXPORT_RANGES.find((r) => r.key === rangeKey);
  if (!range || range.key === 'all') return { from: null, to: null };
  if (range.days) return { from: now - range.days * 86400000, to: null };
  const from = parseExportDate(startDate, false);
  const to = parseExportDate(endDate, true);
  if (from == null || to == null) throw new Error('请选择开始和结束日期');
  if (from > to) throw new Error('开始日期不能晚于结束日期');
  return { from, to };
}

/** 纯函数：范围 + 类型 → 导出 query 串（CSV/GPX 共用）；全部且不限类型给空串 */
function buildExportQuery(opts, now = Date.now()) {
  const o = opts || {};
  const { from, to } = rangeParams(o.rangeKey, o.startDate, o.endDate, now);
  const params = [];
  if (from != null) params.push(`from=${from}`);
  if (to != null) params.push(`to=${to}`);
  if (o.type) params.push(`type=${encodeURIComponent(o.type)}`);
  return params.length ? `?${params.join('&')}` : '';
}

/** 东八区某时刻所在自然日的 0 点 */
function bjDayStart(ms) {
  return Math.floor((ms + 8 * 3600000) / 86400000) * 86400000 - 8 * 3600000;
}

/**
 * 纯函数：步数导出的 query。步数按自然日一条，固定档必须取「含今天共 N 个自然日」，
 * 不能沿用活动导出的滚动 24h（那会把第 N+1 天也带上）。类型参数与步数无关，不带。
 */
function buildStepExportQuery(opts, now = Date.now()) {
  const o = opts || {};
  const range = EXPORT_RANGES.find((r) => r.key === o.rangeKey);
  if (!range || range.key === 'all') return '';
  if (range.days) return `?from=${bjDayStart(now) - (range.days - 1) * 86400000}`;
  const { from, to } = rangeParams('custom', o.startDate, o.endDate, now);
  return `?from=${from}&to=${to}`;
}

/**
 * 纯函数：非 2xx 响应体 → 提示文案。arraybuffer 响应的错误体按 UTF-8 解 JSON 取 message，
 * 解不出来给空串（调用方回落通用文案）。
 * 手写 UTF-8 解码：小程序运行时没有 TextDecoder，逐字节 fromCharCode 会把中文解成乱码。
 */
function utf8Decode(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i += 1;
    } else if (b < 0xe0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if (b < 0xf0) {
      out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f));
      i += 3;
    } else {
      out += String.fromCodePoint(
        ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f),
      );
      i += 4;
    }
  }
  return out;
}

function decodeErrorMessage(data) {
  try {
    const text = typeof data === 'string' ? data : utf8Decode(new Uint8Array(data || []));
    const json = JSON.parse(text);
    return (json && json.message) || '';
  } catch (e) {
    return '';
  }
}

/** 文件名时间戳 'YYYYMMDD-HHmmss'（东八区 = 本机时区约定，测试按构造时区断言） */
function fileStamp(now = Date.now()) {
  const d = new Date(now + 8 * 3600000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

/**
 * 下载一步：GET apiPath → arraybuffer → 写 USER_DATA_PATH，resolve(本地路径)。
 * 与分享分开成两步的原因：shareFileMessage 会拉起原生面板，loading 蒙层必须先收，
 * 否则挡住面板无法操作（track-detail 单条导出同款顺序）。
 */
function downloadExport(apiPath, fileName) {
  const token = getToken();
  return new Promise((resolve, reject) => {
    wx.request({
      url: config.API_BASE_URL + '/api' + apiPath,
      method: 'GET',
      responseType: 'arraybuffer',
      header: { Authorization: `Bearer ${(token && token.accessToken) || ''}` },
      success: (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(decodeErrorMessage(res.data) || `导出失败(${res.statusCode})`));
          return;
        }
        const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`;
        try {
          wx.getFileSystemManager().writeFileSync(filePath, res.data);
        } catch (e) {
          reject(new Error('文件写入失败'));
          return;
        }
        resolve(filePath);
      },
      fail: () => reject(new Error('网络异常，导出失败')),
    });
  });
}

/** 分享一步：拉起文件分享（文件传输助手 → 电脑）。用户取消面板走 fail，给中性文案不算故障 */
function shareExportFile(filePath, fileName) {
  return new Promise((resolve, reject) => {
    wx.shareFileMessage({
      filePath,
      fileName,
      success: () => resolve(filePath),
      fail: () => reject(new Error('分享未完成，文件已生成可重试')),
    });
  });
}

/**
 * 删除本地中转文件（静默，失败忽略——文件可能已被系统接管/已删）。
 * USER_DATA_PATH 配额 200MB：导出 zip 动辄几十 MB，微信不会自动清理，
 * 不删的话反复导出会把配额吃满，之后 writeFileSync 全部报「文件写入失败」。
 */
function removeLocalFile(filePath) {
  try {
    wx.getFileSystemManager().unlink({ filePath, fail: () => {} });
  } catch (e) {
    // unlink 本身抛错（路径非法等）同样忽略：清理失败不该影响主流程
  }
}

/**
 * 两步连做（简单调用方用）。
 * 分享结束（无论成功/取消/失败）后**延迟 10s 删除本地中转文件**（2026-11-19）：
 *   - 延迟是给系统分享链路留缓冲——success 回调时文件可能还在被微信面板/目标应用读取；
 *   - 10s 后用户早已离开分享面板，删除无感；
 *   - 取消/失败同样删：用户取消说明不需要了，重导会生成新文件（文件名带时间戳，留着只会堆积）。
 * 走 export.js 自定义流程的调用方（自己拿 filePath 做后续动作）不经过这里，各自负责删除。
 */
async function downloadAndShare(apiPath, fileName) {
  const filePath = await downloadExport(apiPath, fileName);
  try {
    await shareExportFile(filePath, fileName);
    setTimeout(() => removeLocalFile(filePath), 10_000);
    return filePath;
  } catch (err) {
    // 分享取消/失败：立即删（用户重导会生成新文件；留着只会堆积吃配额）
    removeLocalFile(filePath);
    throw err;
  }
}

/** 运动记录 CSV 导出（时间档/自定义 + 类型） */
function exportRecordsCsv(opts) {
  return downloadAndShare(
    `/activities/export/summary${buildExportQuery(opts)}`,
    `运动记录_${fileStamp()}.csv`,
  );
}

/** 轨迹记录 GPX 打包导出（时间档/自定义 + 类型，单次最多 100 条由后端兜底） */
function exportTracksZip(opts) {
  return downloadAndShare(
    `/activities/export/gpx${buildExportQuery(opts)}`,
    `轨迹导出_${fileStamp()}.zip`,
  );
}

/** 足迹 CSV 导出（时间档/自定义；visitDate 按自然日换算由后端完成，前端与活动导出同 query 口径） */
function exportFootprintCsv(opts) {
  return downloadAndShare(
    `/footprint-records/export/csv${buildExportQuery(opts)}`,
    `足迹记录_${fileStamp()}.csv`,
  );
}

/** 照片打包 zip 导出（轨迹打点 + 足迹双源；会员权益，单次上限 200 张由后端兜底） */
function exportPhotosZip(opts) {
  return downloadAndShare(
    `/activities/export/photos${buildExportQuery(opts)}`,
    `照片导出_${fileStamp()}.zip`,
  );
}

/**
 * 启动清理（2026-11-19）：扫 USER_DATA_PATH 下本工具导出的遗留文件，删 1 小时前的。
 * 挂在导出页 onLoad：把老用户已经堆积的中转文件扫掉（分享过/忘记分享的都在内）。
 * 只删认识的名字（运动记录_/微信步数_/足迹记录_/照片导出_/轨迹导出_ 前缀 + 当天/旧时间戳），
 * 刚下载还没分享完的（1 小时内）不动，防止把进行中的导出误删。
 */
function cleanupStaleExports(now = Date.now()) {
  const PREFIXES = ['运动记录_', '微信步数_', '足迹记录_', '照片导出_', '轨迹导出_'];
  const HOUR = 3600_000;
  try {
    const fsm = wx.getFileSystemManager();
    fsm.readdir({
      dirPath: wx.env.USER_DATA_PATH,
      success: (res) => {
        for (const name of res.files || []) {
          if (!PREFIXES.some((p) => name.startsWith(p))) continue;
          // 文件名时间戳 'YYYYMMDD-HHmmss' → 与 now 比；解析失败按最老处理（1 小时阈值内不误删进行中的）
          const m = name.match(/_(\d{8})-(\d{6})\./);
          let ageMs = Infinity;
          if (m) {
            const [d, t] = [m[1], m[2]];
            const ts = Date.parse(
              `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}+08:00`,
            );
            if (Number.isFinite(ts)) ageMs = now - ts;
          }
          if (ageMs >= HOUR) {
            fsm.unlink({ filePath: `${wx.env.USER_DATA_PATH}/${name}`, fail: () => {} });
          }
        }
      },
      fail: () => {},
    });
  } catch (e) {
    // 清理失败静默：它只是卫生措施，不该影响导出页可用性
  }
}

module.exports = {
  GPX_MAX_ITEMS,
  cleanupStaleExports,
  removeLocalFile,
  exportFootprintCsv,
  exportPhotosZip,
  EXPORT_RANGES,
  parseExportDate,
  rangeParams,
  buildExportQuery,
  buildStepExportQuery,
  decodeErrorMessage,
  fileStamp,
  utf8Decode,
  downloadExport,
  shareExportFile,
  downloadAndShare,
  exportRecordsCsv,
  exportTracksZip,
};

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

/** 导出范围选项（我的页弹层）：days 缺省 = 全部 */
const SUMMARY_RANGES = [
  { key: 'all', label: '全部记录' },
  { key: '30d', label: '最近 30 天', days: 30 },
  { key: '90d', label: '最近 90 天', days: 90 },
];

/**
 * 纯函数：范围 key + 类型 → summary 接口 query 串（test 覆盖）。
 * 全部且不限类型给空串（URL 不带多余参数）。
 */
function buildSummaryQuery(rangeKey, type, now = Date.now()) {
  const range = SUMMARY_RANGES.find((r) => r.key === rangeKey);
  const params = [];
  if (range && range.days) params.push(`from=${now - range.days * 86400000}`);
  if (type) params.push(`type=${encodeURIComponent(type)}`);
  return params.length ? `?${params.join('&')}` : '';
}

/**
 * 纯函数：勾选轨迹 id → gpx 接口 query 串。去重、超上限截断并标记 overflow
 * （调用方据此 toast，不静默丢数据）。
 */
function buildGpxQuery(ids) {
  const uniq = [...new Set((ids || []).map((s) => String(s || '').trim()).filter(Boolean))];
  if (!uniq.length) return { query: '', overflow: false };
  const overflow = uniq.length > GPX_MAX_ITEMS;
  const picked = overflow ? uniq.slice(0, GPX_MAX_ITEMS) : uniq;
  return { query: `?ids=${picked.join(',')}`, overflow };
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

/** 两步连做（简单调用方用） */
async function downloadAndShare(apiPath, fileName) {
  const filePath = await downloadExport(apiPath, fileName);
  await shareExportFile(filePath, fileName);
  return filePath;
}

/** 汇总 CSV 导出（我的页弹层入口） */
function exportSummaryCsv(rangeKey, type) {
  return downloadAndShare(
    `/activities/export/summary${buildSummaryQuery(rangeKey, type)}`,
    `运动记录_${fileStamp()}.csv`,
  );
}

/** 多条轨迹 GPX 打包导出（轨迹页多选入口）；返回 { promise, overflow } 让调用方先提示截断 */
function exportGpxZip(ids) {
  const { query, overflow } = buildGpxQuery(ids);
  return {
    overflow,
    promise: downloadAndShare(`/activities/export/gpx${query}`, `轨迹导出_${fileStamp()}.zip`),
  };
}

module.exports = {
  GPX_MAX_ITEMS,
  SUMMARY_RANGES,
  buildSummaryQuery,
  buildGpxQuery,
  decodeErrorMessage,
  fileStamp,
  utf8Decode,
  downloadExport,
  shareExportFile,
  downloadAndShare,
  exportSummaryCsv,
  exportGpxZip,
};

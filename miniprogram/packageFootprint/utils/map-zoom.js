// 点亮地图缩放（页面上 +/− 按钮）：读 chart 当前 zoom，乘/除系数后夹到 [MIN_ZOOM, MAX_ZOOM]
// 足迹页与统计页共用；两页各有「卡片小图 + 全屏图」两个 chart 实例，由页面决定作用在哪个上
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 8;
const ZOOM_FACTOR = 1.3;

/**
 * 对 chart 应用一次缩放（setOption 更新 map series 的 zoom，方向可靠）
 * @param {object} chart echarts 实例（可能尚未就绪）
 * @param {number} factor 缩放系数（>1 放大、<1 缩小）
 * @returns {number|null} 落地后的 zoom；chart 未就绪时返回 null
 */
function zoomChart(chart, factor) {
  if (!chart || typeof chart.getOption !== 'function' || typeof chart.setOption !== 'function') return null;
  const opt = chart.getOption();
  const cur = (opt && opt.series && opt.series[0] && opt.series[0].zoom) || 1;
  const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cur * factor));
  chart.setOption({ series: [{ zoom: next }] });
  return next;
}

module.exports = { zoomChart, ZOOM_FACTOR, MIN_ZOOM, MAX_ZOOM };

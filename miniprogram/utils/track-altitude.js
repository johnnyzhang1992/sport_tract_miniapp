/**
 * 海拔曲线的口径：只有徒步/爬山看。
 *
 * 手机 GPS 的逐点海拔噪声很大（同一位置 ±10m 抖动是常态），跑步/骑行这种贴地运动的曲线
 * 基本是噪声而非地形，展示出来没有参考价值——所以曲线与「轨迹线按海拔着色」共用这一份白名单，
 * 别在两处各写一份。
 */
const ALTITUDE_TYPES = ['hiking', 'mountaineering'];
/** 曲线最多取多少个点（stat-chart 画折线够用，再多只是浪费 setData 体积） */
const MAX_POINTS = 60;

/**
 * 组装海拔曲线数据；非徒步/爬山（或缺类型）直接返回空数组，由调用方据此不渲染。
 * 抽稀按「有效海拔点」计数：中间夹着的空海拔点不占名额。
 * @param {Array<{altitude: number|null}>} [trackPoints] 轨迹点
 * @param {string} type 运动类型（config.ACTIVITY_TYPES 的 type）
 * @returns {Array<{label: string, value: number}>} 空数组 = 不展示
 */
function buildAltitudeChart(trackPoints, type) {
  if (!ALTITUDE_TYPES.includes(type)) return [];
  const altPts = (trackPoints || []).filter((p) => p.altitude != null);
  const step = Math.max(1, Math.ceil(altPts.length / MAX_POINTS));
  return altPts.filter((_, i) => i % step === 0).map((p, i) => ({ label: String(i), value: p.altitude }));
}

module.exports = { ALTITUDE_TYPES, buildAltitudeChart };

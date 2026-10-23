/**
 * 近 90 天 vs 近 365 天日均距离对比（统计页趋势增强）
 * 口径：距离日均（km，1 位小数）；分母取接口实际返回的天数（正常为 90 / 365）。
 * 差异在 ±5% 内视为持平，避免小波动天天换箭头。
 */
const FLAT_PCT = 5;
const METERS_PER_KM = 1000;

function sumDistance(rows) {
  return rows.reduce((sum, r) => sum + (Number(r.distance) || 0), 0);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * @param {Array<{distance:number}>} rows 近 365 天按天升序（接口 daily365）
 * @returns {{avg90:number, avg365:number, diffPct:number, dir:'up'|'down'|'flat'}|null}
 */
function buildTrendCompare(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const total = sumDistance(rows);
  if (total <= 0) return null;

  const recent = rows.slice(-90);
  const recentSum = sumDistance(recent);
  const raw90 = recentSum / (recent.length || 1);
  const raw365 = total / rows.length;
  const diffPct = Math.round(((raw90 - raw365) / raw365) * 100);

  return {
    avg90: round1(raw90 / METERS_PER_KM),
    avg365: round1(raw365 / METERS_PER_KM),
    diffPct,
    dir: Math.abs(diffPct) < FLAT_PCT ? 'flat' : diffPct > 0 ? 'up' : 'down',
  };
}

module.exports = { buildTrendCompare };

/**
 * 周期对比变化百分比（stats 页 / report 页共用）
 * - 基数（上周期）为 0：本期有值 → 「新增」，否则 → 「—」
 * - 变化 ±0.05% 内 → 「持平」
 * - 否则 → ±x.x% ，cls 区分 up（增）/ down（减）
 */
function calcDiff(cur, prev) {
  if (prev <= 0) return cur > 0 ? { text: '新增', cls: 'up' } : { text: '—', cls: 'flat' };
  const pct = ((cur - prev) / prev) * 100;
  if (Math.abs(pct) < 0.05) return { text: '持平', cls: 'flat' };
  return { text: `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`, cls: pct > 0 ? 'up' : 'down' };
}

module.exports = { calcDiff };

/**
 * 周计划概况卡标题：日期范围 + 本期第几天。
 * 例：11.12–11.18（第 1/7 天）；缺窗口数据时回落「本期」（旧接口/加载异常）。
 */
const { bjParts } = require('./bj-date');

const DAY_MS = 86_400_000;

function fmtMonthDay(ms) {
  const p = bjParts(ms);
  return `${p.m}.${p.d}`;
}

function formatPeriodTitle(start, end, now = Date.now()) {
  if (!start || !end) return '本期';
  const total = Math.max(1, Math.round((end - start) / DAY_MS));
  // 末日按区间结束回退一天；天数夹在 [1, total]（时钟偏差/跨期瞬间不越界）
  const day = Math.min(total, Math.max(1, Math.floor((now - start) / DAY_MS) + 1));
  return `${fmtMonthDay(start)}–${fmtMonthDay(end - DAY_MS)}（第 ${day}/${total} 天）`;
}

module.exports = { formatPeriodTitle };

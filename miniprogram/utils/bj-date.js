/** 东八区日期格式化：不依赖设备时区（Date 按 UTC 取值前先加 8h） */
const OFFSET_MS = 8 * 3600 * 1000;
const pad = (n) => String(n).padStart(2, '0');

/** epoch → 东八区 YYYY-MM-DD；非法/空值 → '' */
function bjDate(ms) {
  if (!ms) return '';
  const d = new Date(ms + OFFSET_MS);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** epoch → 东八区 YYYY-MM-DD HH:mm；非法/空值 → '' */
function bjDateTime(ms) {
  if (!ms) return '';
  const d = new Date(ms + OFFSET_MS);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/**
 * 东八区「日/周/月/年」边界的毫秒值（不依赖设备时区）。
 *
 * 为什么必须有这组函数：`new Date(y, m, d)` 走的是**设备本地时区**，非 +8 设备上算出的
 * 「自然日/自然周/自然年」边界会偏移几个小时，而服务端一律按东八区自然日换算 →
 * 边界那天会被算进错误的周期（2026-11-06 审出：报告页 periodRange / 年度报告 yearRange）。
 */
const DAY_MS = 86400000;

/** epoch → 该时刻所在东八区自然日的 0 点（毫秒） */
function bjDayStart(ms) {
  return Math.floor((ms + OFFSET_MS) / DAY_MS) * DAY_MS - OFFSET_MS;
}

/** 东八区 y/m/d 的 0 点（毫秒）；m 从 1 开始，允许越界（Date.UTC 自动进位） */
function bjMid(y, m, d) {
  return Date.UTC(y, m - 1, d) - OFFSET_MS;
}

/** epoch → 东八区分量 { y, m(1-12), d, dow(0=周日) } */
function bjParts(ms) {
  const d = new Date(ms + OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), dow: d.getUTCDay() };
}

/** 含该时刻的东八区自然周起点（周一 0 点） */
function bjWeekStart(ms) {
  const p = bjParts(ms);
  return bjMid(p.y, p.m, p.d - ((p.dow + 6) % 7));
}

module.exports = { bjDate, bjDateTime, bjDayStart, bjMid, bjParts, bjWeekStart };

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

module.exports = { bjDate, bjDateTime };

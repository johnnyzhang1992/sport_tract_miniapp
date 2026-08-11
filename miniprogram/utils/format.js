/**
 * 通用格式化工具
 */

/** 秒 → "1:23:45"（超 1 小时）或 "23:45" */
function formatDuration(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}

/** 米 → 公里字符串 */
function formatKm(meters) {
  return (meters / 1000).toFixed(2);
}

/** 秒/公里 → “5.5 分钟/公里” / “12 分钟/公里”（整数不带小数） */
function formatPace(secPerKm) {
  if (!secPerKm || secPerKm <= 0) return '—';
  const minutes = secPerKm / 60;
  const text = Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1);
  return `${text} 分钟/公里`;
}

module.exports = { formatDuration, formatKm, formatPace };

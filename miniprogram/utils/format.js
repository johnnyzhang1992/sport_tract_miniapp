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

/** 秒/公里 → “7'30"/公里” */
function formatPace(secPerKm) {
  if (!secPerKm || secPerKm <= 0) return '—';
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}'${String(s).padStart(2, '0')}" /公里`;
}

/** 配速拆分为值 + 单位（页面可分别控制字号，如 “2'13\”” + “/公里”） */
function formatPaceParts(secPerKm) {
  if (!secPerKm || secPerKm <= 0) return null;
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return { value: `${m}'${String(s).padStart(2, '0')}"`, unit: '/公里' };
}

module.exports = { formatDuration, formatKm, formatPace, formatPaceParts };

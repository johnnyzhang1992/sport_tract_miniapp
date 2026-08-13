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

/** 数字缩写：≥10000 → 1.22W，≥1000 → 1.22K，否则去尾零保留2位 */
function compact(v) {
  if (v >= 10000) return (v / 10000).toFixed(2).replace(/\.?0+$/, '') + 'W';
  if (v >= 1000) return (v / 1000).toFixed(2).replace(/\.?0+$/, '') + 'K';
  return String(Math.round(v * 100) / 100);
}

/** 总时长统计：≤999分钟→分钟；≤999小时→小时；否则→天（返回 { num, unit }） */
function formatDurationStat(seconds) {
  const min = (seconds || 0) / 60;
  if (min <= 999) return { num: String(Math.round(min)), unit: '分钟' };
  const h = min / 60;
  if (h <= 999) return { num: String(Math.round(h * 10) / 10), unit: '小时' };
  return { num: String(Math.round((h / 24) * 10) / 10), unit: '天' };
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

module.exports = { formatDuration, formatKm, formatPace, formatPaceParts, compact, formatDurationStat };

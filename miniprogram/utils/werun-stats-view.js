/**
 * 步数统计页纯函数：概况/趋势/每日明细 → WXML 展示值。
 * 运行：node --test test/werun-stats-view.test.js。
 */
const { formatCompactCn, formatThousands } = require('./format.js');

/** 'YYYY-MM-DD' → 'YYYY/MM/DD'（全站日期分隔符） */
function slashDate(date) {
  return String(date || '').replace(/-/g, '/');
}

/** 'YYYY-MM-DD' → 'MM/DD' */
function mmdd(date) {
  return String(date || '').slice(5).replace('-', '/');
}

/** 概况：总步数用中文缩写（≥1万→万），单日明细保留千分位精确值 */
function buildOverview(o, startDate, endDate) {
  const has = o && o.syncedDays > 0;
  return {
    totalText: formatCompactCn((o && o.totalStep) || 0),
    avgText: formatCompactCn((o && o.avgStep) || 0),
    bestText: has ? formatCompactCn(o.bestStep) : '—',
    bestDateText: has && o.bestDate ? mmdd(o.bestDate) : '',
    syncedDays: (o && o.syncedDays) || 0,
    rangeText: startDate && endDate ? `${slashDate(startDate)} ~ ${slashDate(endDate)}` : '',
  };
}

const BUCKET_TEXT = { day: '按日', week: '按周', month: '按月' };

/** 趋势：stat-chart 柱状图只吃 { label, value }；月标签 YYYY/MM 更长，放宽占位 */
function buildTrend(trend, bucket) {
  return {
    data: (trend || []).map((x) => ({ label: x.label, value: Number(x.step) || 0 })),
    subText: BUCKET_TEXT[bucket] || '',
    labelSlot: bucket === 'month' ? 36 : 28,
  };
}

/** 每日明细行：日期/星期/步数（精确千分位） */
function buildDayItems(items) {
  return (items || []).map((x) => ({
    date: x.date,
    dateText: slashDate(x.date),
    weekday: x.weekday || '',
    stepText: formatThousands(x.step),
  }));
}

/** 涨跌箭头（与统计页趋势卡同一套图标） */
const ARROW_ICON = {
  up: '/assets/icons/lucide-trending-up-green.png',
  down: '/assets/icons/lucide-trending-down-red.png',
  flat: '/assets/icons/lucide-minus-gray.png',
  none: '',
};
const FLAT_PCT = 5;

/** 步数趋势变化卡：近 30 天 vs 前 30 天；上一周期没数据时不给百分比 */
function changeOf(cur, prev) {
  if (!(prev > 0)) return { dir: 'none', diffText: '', arrowIcon: '' };
  const raw = ((cur - prev) / prev) * 100;
  const pct = Math.round(raw);
  const dir = Math.abs(pct) < FLAT_PCT ? 'flat' : pct > 0 ? 'up' : 'down';
  return {
    dir,
    diffText: pct === 0 ? '0%' : `${pct > 0 ? '+' : ''}${pct}%`,
    arrowIcon: ARROW_ICON[dir],
  };
}

/** 步数趋势变化四卡：总步数 / 日均 / 最高单日 / 记录天数 */
function buildStepMetricCards(cur, prev) {
  if (!cur) return [];
  if ((Number(cur.totalStep) || 0) === 0 && (!prev || (Number(prev.totalStep) || 0) === 0)) return [];
  return [
    { key: 'total', label: '总步数', value: formatCompactCn(cur.totalStep), unit: '步', ...changeOf(Number(cur.totalStep) || 0, prev && Number(prev.totalStep) || 0) },
    { key: 'avg', label: '日均', value: formatCompactCn(cur.avgStep), unit: '步/天', ...changeOf(Number(cur.avgStep) || 0, prev && Number(prev.avgStep) || 0) },
    { key: 'best', label: '最高单日', value: formatCompactCn(cur.bestStep), unit: '步', ...changeOf(Number(cur.bestStep) || 0, prev && Number(prev.bestStep) || 0) },
    { key: 'days', label: '记录天数', value: String(Number(cur.syncedDays) || 0), unit: '天', ...changeOf(Number(cur.syncedDays) || 0, prev && Number(prev.syncedDays) || 0) },
  ];
}

module.exports = { buildOverview, buildTrend, buildDayItems, buildStepMetricCards, slashDate, mmdd };

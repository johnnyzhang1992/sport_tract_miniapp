/**
 * 统计页「运动趋势」五张变化卡（纯函数，node --test test/stats-metrics.test.js）。
 *
 * 口径（用户确认）：
 * - 窗口：近 30 天 vs 再往前 30 天；天数按**实际桶数**取，缺的天数不当成「0 日均」。
 * - 主值：时长/距离/消耗用日均，次数用窗口总量（日均 0.4 次读着没意义）。
 * - 配速：distance ÷ (duration − standstillMs)，与详情页「剔静止」同口径；
 *   数值变小＝变快，所以箭头方向要反一次。
 * - 箭头一律表示「变好」；相对变化落在 ±5% 内算持平（沿用统计页原先那条 90d/365d 对比的 ±5% 阈值）。
 */
const WINDOW_DAYS = 30;
const FLAT_PCT = 5;

function sumOf(rows, key) {
  return rows.reduce((sum, r) => sum + (Number(r[key]) || 0), 0);
}

function totals(rows) {
  return {
    distance: sumOf(rows, 'distance'),
    duration: sumOf(rows, 'duration'),
    count: sumOf(rows, 'count'),
    calories: sumOf(rows, 'calories'),
    standstillMs: sumOf(rows, 'standstillMs'),
  };
}

/** 秒/公里；全程没距离或净时长为 0 时返回 null（不拿 0 冒充配速） */
function paceOf(t) {
  // duration 是**秒**、standstillMs 是**毫秒**，别直接相减
  const netSec = t.duration - t.standstillMs / 1000;
  if (!(t.distance > 0) || !(netSec > 0)) return null;
  return (netSec * 1000) / t.distance;
}

/** lucide 字形（96px 透明底 PNG，scripts/gen-category-icons.mjs 的 PLAIN 组出图） */
const ARROW_ICON = {
  up: '/assets/icons/lucide-trending-up-green.png',
  down: '/assets/icons/lucide-trending-down-red.png',
  flat: '/assets/icons/lucide-minus-gray.png',
  none: '',
};
/** 没得比（上一段为 0）：不给箭头也不给百分比，别编一个 0% 出来 */
const NO_CHANGE = { dir: 'none', pct: null, diffText: '', arrowIcon: '' };

/** 涨跌：`higherBetter` 为 false 时（配速）把方向反一次 */
function changeOf(recent, prev, higherBetter) {
  if (!(prev > 0)) return NO_CHANGE;
  const raw = ((recent - prev) / prev) * 100;
  const pct = Math.round(higherBetter ? raw : -raw);
  const dir = Math.abs(pct) < FLAT_PCT ? 'flat' : pct > 0 ? 'up' : 'down';
  return { dir, pct, diffText: pct === 0 ? '0%' : `${pct > 0 ? '+' : ''}${pct}%`, arrowIcon: ARROW_ICON[dir] };
}

function buildMetricCards(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const all = totals(list);
  if (!all.distance && !all.duration && !all.count && !all.calories) return [];

  const recentRows = list.slice(-WINDOW_DAYS);
  const prevRows = list.slice(-2 * WINDOW_DAYS, -WINDOW_DAYS);
  const recent = totals(recentRows);
  const prev = totals(prevRows);
  const rDays = recentRows.length || 1;
  const pDays = prevRows.length || 1;

  const { formatDurationStat, formatPaceParts } = require('./format.js');
  const dur = formatDurationStat(recent.duration / rDays);
  const pace = paceOf(recent);
  const prevPace = paceOf(prev);
  const paceParts = pace ? formatPaceParts(pace) : null;

  const cards = [
    {
      key: 'distance',
      label: '距离',
      value: (recent.distance / 1000 / rDays).toFixed(1),
      unit: '公里/天',
      ...changeOf(recent.distance / rDays, prev.distance / pDays, true),
    },
    {
      key: 'duration',
      label: '时长',
      value: dur.num,
      unit: `${dur.unit}/天`,
      ...changeOf(recent.duration / rDays, prev.duration / pDays, true),
    },
    {
      key: 'count',
      label: '次数',
      value: String(recent.count),
      unit: '次',
      ...changeOf(recent.count, prev.count, true),
    },
    {
      key: 'pace',
      label: '配速',
      value: paceParts ? paceParts.value : '—',
      unit: paceParts ? paceParts.unit : '',
      // 变快＝秒/公里变小＝更好，方向反过来判
      ...(pace && prevPace ? changeOf(pace, prevPace, false) : NO_CHANGE),
    },
    {
      key: 'calories',
      label: '消耗',
      value: String(Math.round(recent.calories / rDays)),
      unit: '千卡/天',
      ...changeOf(recent.calories / rDays, prev.calories / pDays, true),
    },
  ];
  return cards;
}

/** 半屏趋势图：五个指标的标题/单位/取值（配速用分钟/公里，Y 轴读数是 6、8 这种，不是 520） */
const CHART = {
  distance: { title: '距离趋势', unit: 'km', map: (d) => Math.round((d.distance / 1000) * 100) / 100 },
  duration: { title: '时长趋势', unit: '分钟', map: (d) => Math.round(d.duration / 60) },
  count: { title: '次数趋势', unit: '次', map: (d) => d.count },
  calories: { title: '消耗趋势', unit: '千卡', map: (d) => Math.round(d.calories || 0) },
  pace: {
    title: '配速趋势',
    unit: '分钟/公里',
    note: '数值越小越快',
    map: (d) => {
      const p = paceOf(d);
      return p == null ? null : Math.round((p / 60) * 10) / 10;
    },
  },
};

/** X 轴标签：周/月 → MM-DD；6 个月 → 周号；年 → M月（与聚合桶键同一套） */
function trendLabel(date, trendType) {
  if (trendType === 'year') return `${Number(String(date).slice(5, 7))}月`;
  if (trendType === 'week6') {
    const m = String(date).match(/-W(\d+)/);
    return m ? `W${m[1]}` : String(date).slice(5);
  }
  return String(date).slice(5);
}

/**
 * 半屏趋势图数据。配速单独一路：**没运动的日子整根跳过**——空桶画成 0 会读成「0 配速＝最快」，
 * 语义正好反了；其它四个指标 0 就是 0，照常保留。
 */
function buildTrendChart(rows, metric, trendType) {
  const cfg = CHART[metric];
  if (!cfg) return null;
  const list = Array.isArray(rows) ? rows : [];
  const picked = metric === 'pace' ? list.filter((d) => cfg.map(d) != null) : list;
  return {
    title: cfg.title,
    unit: cfg.unit,
    note: cfg.note || '',
    data: picked.map((d) => ({ label: trendLabel(d.date, trendType), value: cfg.map(d) })),
  };
}

module.exports = { buildMetricCards, buildTrendChart, ARROW_ICON };

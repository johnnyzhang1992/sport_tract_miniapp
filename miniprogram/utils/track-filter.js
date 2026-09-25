/**
 * 轨迹合集页筛选的纯函数：时间档/年份 → 请求参数、候选计算、回落、文案。
 *
 * 为什么时间用单一 period 字段（'week'|'month'|'year'|'all'|'YYYY'）：档位与历史年份本质是同一个
 * 单选维度，合成一个字段就不会出现「选了 2024 年但 range 还是 week」这种自相矛盾的状态。
 * 年份区间按 +08:00 自然年算（服务端分桶也是 +08:00），不跟设备时区漂：
 * 2024 年 = [2024-01-01T00:00+08:00, 2025-01-01T00:00+08:00)。
 *
 * 候选项由页面用快照算好后传给弹窗（与足迹页同一套做法）：省份候选跟随当前时间档
 * （所见即所得，不会出现「选了省却一条都画不出来」），年份候选来自全量快照。
 */
const { shortProvinceName } = require('./footprint-filter.js');

/** 东八区偏移（ms） */
const BEIJING_OFFSET_MS = 8 * 3600 * 1000;

/** 时间档（页面 chips 与海报标题共用同一份） */
const RANGES = [
  { value: 'week', label: '本周' },
  { value: 'month', label: '本月' },
  { value: 'year', label: '本年' },
  { value: 'all', label: '全部' },
];

const DEFAULT_PERIOD = 'week';

const RANGE_LABELS = RANGES.reduce((m, r) => {
  m[r.value] = r.label;
  return m;
}, {});

/** period 是不是「历史年份」档（四位数字符串） */
function isYearPeriod(period) {
  return /^\d{4}$/.test(String(period == null ? '' : period));
}

/** 某年在东八区的起始时刻（epoch ms） */
function beijingYearStart(year) {
  return Date.UTC(Number(year), 0, 1) - BEIJING_OFFSET_MS;
}

/** 时刻 → 东八区年份 */
function beijingYear(ms) {
  return new Date(Number(ms) + BEIJING_OFFSET_MS).getUTCFullYear();
}

/** period → 请求参数：四档走 range，年份走 from/to（接口两者都支持，给了 from/to 就按它取数） */
function rangeQuery(period) {
  if (isYearPeriod(period)) {
    const y = Number(period);
    return { from: beijingYearStart(y), to: beijingYearStart(y + 1) };
  }
  const hit = RANGES.some((r) => r.value === period);
  return { range: hit ? period : DEFAULT_PERIOD };
}

/** period → 文案（'本月' / '2024 年'） */
function periodLabel(period) {
  if (isYearPeriod(period)) return `${Number(period)} 年`;
  return RANGE_LABELS[period] || RANGE_LABELS[DEFAULT_PERIOD];
}

/** 轨迹快照 → 省份候选（按条数降序；没有省的老数据不列进候选） */
function buildProvinceOptions(tracks) {
  const map = new Map();
  (tracks || []).forEach((t) => {
    const name = (t && t.startProvince) || '';
    if (!name) return;
    map.set(name, (map.get(name) || 0) + 1);
  });
  return [...map.entries()]
    .map(([name, count]) => ({ name, label: shortProvinceName(name), count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
}

/**
 * 轨迹快照 → 历史年份候选（降序）。本年不列进候选：档位里的「本年」是近 365 天滑窗，
 * 必然覆盖当前自然年，列出来只会跟它重复。
 */
function buildYearOptions(tracks, nowMs) {
  const current = beijingYear(nowMs == null ? Date.now() : nowMs);
  const map = new Map();
  (tracks || []).forEach((t) => {
    const ms = t && t.startTime ? new Date(t.startTime).getTime() : NaN;
    if (!Number.isFinite(ms)) return;
    const y = beijingYear(ms);
    if (y >= current) return;
    map.set(y, (map.get(y) || 0) + 1);
  });
  return [...map.entries()]
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => b.year - a.year);
}

/** 按省份过滤（空＝全部）；没有省的轨迹在按省筛时不算命中 */
function filterTracks(tracks, state) {
  const province = (state && state.province) || '';
  const list = tracks || [];
  if (!province) return list;
  return list.filter((t) => ((t && t.startProvince) || '') === province);
}

/** 切时间档后候选会变：已选省不在候选里就回落「全部省份」，否则会留个筛不出东西的条件 */
function keepProvince(options, province) {
  if (!province) return '';
  return (options || []).some((o) => o.name === province) ? province : '';
}

/** 是否处于筛选态（默认档 + 全部省份＝未筛选） */
function isFiltered(state) {
  const s = state || {};
  return (s.period || DEFAULT_PERIOD) !== DEFAULT_PERIOD || !!s.province;
}

/** 筛选按钮上的条件摘要（如「本月 · 湖北」） */
function filterSummary(state) {
  const s = state || {};
  const parts = [periodLabel(s.period || DEFAULT_PERIOD)];
  if (s.province) parts.push(shortProvinceName(s.province));
  return parts.join(' · ');
}

/** 分享弹窗标题：条件 + 展示条数（超上限时标注「部分」） */
function shareTitle(state, shownCount, totalCount) {
  const s = state || {};
  const label = periodLabel(s.period || DEFAULT_PERIOD);
  // 中文与数字之间留一个空格（「我的 2024 年轨迹」），档位名都是中文所以不受影响
  const gap = /^\d/.test(label) ? ' ' : '';
  const prov = s.province ? `（${shortProvinceName(s.province)}）` : '';
  const partial = Number(totalCount) > Number(shownCount) ? '（部分）' : '';
  return `我的${gap}${label}轨迹${prov} · ${shownCount} 条${partial}`;
}

module.exports = {
  RANGES,
  DEFAULT_PERIOD,
  BEIJING_OFFSET_MS,
  isYearPeriod,
  beijingYearStart,
  beijingYear,
  rangeQuery,
  periodLabel,
  buildProvinceOptions,
  buildYearOptions,
  filterTracks,
  keepProvince,
  isFiltered,
  filterSummary,
  shareTitle,
};

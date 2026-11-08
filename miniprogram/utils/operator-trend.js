/**
 * 运营趋势视图纯函数（2026-11-08）：组合约束与 API operator-trend 同表。
 * 文案/计数归服务端；这里只做组合可用性、默认回退与 buckets→图表系列映射。
 */
const RANGES = [
  { key: 'week', label: '最近一周' },
  { key: 'month', label: '最近一月' },
  { key: 'halfyear', label: '最近半年' },
];

/** 周粒度对最近一周只有 1 桶；天粒度对半年 180 桶×3 系列柱放不下 */
function granularityOptions(range) {
  return [
    { key: 'day', label: '天', disabled: range === 'halfyear' },
    { key: 'week', label: '周', disabled: range === 'week' },
  ];
}

function defaultGranularity(range) {
  return range === 'halfyear' ? 'week' : 'day';
}

function normalizeGranularity(range, g) {
  const opt = granularityOptions(range).find((o) => o.key === g);
  return opt && !opt.disabled ? g : defaultGranularity(range);
}

const SERIES_META = [
  { field: 'newUsers', name: '新增用户', color: '#2b6cf6' },
  { field: 'uv', name: '登录UV', color: '#7fa8f9' },
  { field: 'pv', name: '登录PV', color: '#b6cff8' },
];

function buildUserSeries(buckets) {
  const rows = buckets || [];
  return {
    labels: rows.map((b) => b.label),
    series: SERIES_META.map((m) => ({
      name: m.name,
      color: m.color,
      values: rows.map((b) => Number(b[m.field]) || 0),
    })),
  };
}

function buildTrackData(buckets) {
  return (buckets || []).map((b) => ({ label: b.label, value: Number(b.tracksCreated) || 0 }));
}

module.exports = { RANGES, granularityOptions, defaultGranularity, normalizeGranularity, buildUserSeries, buildTrackData };
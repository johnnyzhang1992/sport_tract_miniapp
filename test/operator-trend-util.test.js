/**
 * 运营趋势纯函数（2026-11-08）：范围×粒度组合表、默认回退、buckets→图表系列映射。
 * 组合约束与 API 同表：week 仅 day；halfyear 仅 week；month 两者。
 * 运行：node --test test/operator-trend-util.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  RANGES,
  granularityOptions,
  defaultGranularity,
  normalizeGranularity,
  buildUserSeries,
  buildTrackData,
} = require('../miniprogram/utils/operator-trend');

test('OTU1 组合表：week 禁周、halfyear 禁天、month 全开；默认粒度与回退', () => {
  assert.deepEqual(RANGES.map((r) => r.key), ['week', 'month', 'halfyear']);
  const week = granularityOptions('week');
  assert.equal(week.find((o) => o.key === 'day').disabled, false);
  assert.equal(week.find((o) => o.key === 'week').disabled, true);
  const half = granularityOptions('halfyear');
  assert.equal(half.find((o) => o.key === 'day').disabled, true);
  assert.equal(half.find((o) => o.key === 'week').disabled, false);
  const month = granularityOptions('month');
  assert.ok(month.every((o) => !o.disabled));

  assert.equal(defaultGranularity('week'), 'day');
  assert.equal(defaultGranularity('month'), 'day');
  assert.equal(defaultGranularity('halfyear'), 'week');
  assert.equal(normalizeGranularity('halfyear', 'day'), 'week', '切到半年时天粒度回退周');
  assert.equal(normalizeGranularity('week', 'week'), 'day', '切到一周时周粒度回退天');
  assert.equal(normalizeGranularity('month', 'week'), 'week', '可用粒度保留用户选择');
});

test('OTU2 buckets→三系列：顺序/颜色/值/标签；空桶补 0 透传', () => {
  const buckets = [
    { key: '2026-11-01', label: '11/1', newUsers: 1, uv: 2, pv: 3, tracksCreated: 4 },
    { key: '2026-11-02', label: '11/2', newUsers: 0, uv: 0, pv: 0, tracksCreated: 0 },
  ];
  const { labels, series } = buildUserSeries(buckets);
  assert.deepEqual(labels, ['11/1', '11/2']);
  assert.deepEqual(series.map((s) => s.name), ['新增用户', '登录UV', '登录PV']);
  assert.deepEqual(series.map((s) => s.values), [[1, 0], [2, 0], [3, 0]]);
  assert.equal(new Set(series.map((s) => s.color)).size, 3, '三系列颜色互异');
  assert.ok(series.every((s) => /^#[0-9a-f]{6}$/i.test(s.color)));
  const empty = buildUserSeries([]);
  assert.deepEqual(empty.labels, []);
  assert.ok(empty.series.every((s) => s.values.length === 0));
});

test('OTU3 buckets→轨迹柱状数据：label/value 映射', () => {
  const buckets = [
    { label: '11/1', tracksCreated: 4 },
    { label: '11/2', tracksCreated: 0 },
  ];
  assert.deepEqual(buildTrackData(buckets), [
    { label: '11/1', value: 4 },
    { label: '11/2', value: 0 },
  ]);
  assert.deepEqual(buildTrackData([]), []);
});
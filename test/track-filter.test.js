/**
 * 轨迹合集页筛选的纯函数（utils/track-filter.js）单测。
 *
 * 为什么要有这层：页面把「时间档（本周/本月/本年/全部 + 历史年份）」与「省份」两个筛选维度
 * 拼成请求、算候选、做回落，还要把条件写进分享标题——全是不依赖 UI 的纯计算，
 * 抽出来能钉死口径，尤其是东八区跨年边界（服务端按 +08:00 分桶，前端不能跟着设备时区漂）。
 * 运行：npm test（node --test 自动发现）；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const tf = require('../miniprogram/utils/track-filter.js');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

test('TF1 rangeQuery：四档时间原样透传给 range，默认档是本周', () => {
  assert.equal(tf.DEFAULT_PERIOD, 'week');
  ['week', 'month', 'year', 'all'].forEach((p) => {
    assert.deepEqual(tf.rangeQuery(p), { range: p }, `${p} 应原样透传`);
  });
});

test('TF2 rangeQuery：年份 → 东八区自然年区间（左闭右开）', () => {
  // 2024-01-01T00:00+08:00 = 2023-12-31T16:00Z = 1704038400000
  // 2025-01-01T00:00+08:00 = 2024-12-31T16:00Z = 1735660800000
  assert.deepEqual(tf.rangeQuery('2024'), { from: 1704038400000, to: 1735660800000 });
  // 闰年（2024）区间长度 366 天，平年（2023）365 天——顺手钉住"按自然年而不是近 365 天"
  const leap = tf.rangeQuery('2024');
  const plain = tf.rangeQuery('2023');
  assert.equal(leap.to - leap.from, 366 * DAY, '2024 是闰年');
  assert.equal(plain.to - plain.from, 365 * DAY, '2023 是平年');
});

test('TF3 periodLabel：四档用中文档名，年份档带「年」', () => {
  assert.equal(tf.periodLabel('week'), '本周');
  assert.equal(tf.periodLabel('month'), '本月');
  assert.equal(tf.periodLabel('year'), '本年');
  assert.equal(tf.periodLabel('all'), '全部');
  assert.equal(tf.periodLabel('2024'), '2024 年');
});

test('TF4 buildProvinceOptions：按条数降序、短名显示、跳过没有省的轨迹', () => {
  const tracks = [
    { startProvince: '湖北省' },
    { startProvince: '湖北省' },
    { startProvince: '上海市' },
    { startProvince: '上海市' },
    { startProvince: '上海市' },
    { startProvince: '' }, // 老数据没有省
    {}, // 字段都没有
  ];
  assert.deepEqual(tf.buildProvinceOptions(tracks), [
    { name: '上海市', label: '上海', count: 3 },
    { name: '湖北省', label: '湖北', count: 2 },
  ]);
  assert.deepEqual(tf.buildProvinceOptions([]), []);
});

test('TF5 buildYearOptions：只列有轨迹的历史年份（降序），本年不进候选', () => {
  const tracks = [
    { startTime: '2024-03-01T02:00:00.000Z' },
    { startTime: '2024-08-01T02:00:00.000Z' },
    { startTime: '2025-06-01T02:00:00.000Z' },
    { startTime: '2026-01-01T02:00:00.000Z' }, // 东八区 2026-01-01 10:00
    { startTime: '' },
  ];
  const now = Date.UTC(2026, 8, 25, 4); // 2026-09-25 12:00 东八区
  assert.deepEqual(tf.buildYearOptions(tracks, now), [
    { year: 2025, count: 1 },
    { year: 2024, count: 2 },
  ]);
});

test('TF6 buildYearOptions：年份按东八区判（跨年边界不能跟着设备时区漂）', () => {
  // 2024-12-31T17:00Z = 2025-01-01 01:00 东八区 → 算 2025 年
  // 2024-12-31T15:00Z = 2024-12-31 23:00 东八区 → 算 2024 年
  const tracks = [{ startTime: '2024-12-31T17:00:00.000Z' }, { startTime: '2024-12-31T15:00:00.000Z' }];
  const now = Date.UTC(2026, 0, 1, 4); // 2026 年，两个都在历史里
  assert.deepEqual(tf.buildYearOptions(tracks, now), [
    { year: 2025, count: 1 },
    { year: 2024, count: 1 },
  ]);
});

test('TF7 filterTracks：省份为空＝全部；按省筛时没有省的轨迹不算命中', () => {
  const tracks = [{ id: 'a', startProvince: '湖北省' }, { id: 'b', startProvince: '上海市' }, { id: 'c', startProvince: '' }];
  assert.deepEqual(tf.filterTracks(tracks, { province: '' }).map((t) => t.id), ['a', 'b', 'c']);
  assert.deepEqual(tf.filterTracks(tracks, { province: '湖北省' }).map((t) => t.id), ['a']);
  assert.deepEqual(tf.filterTracks(tracks, {}).map((t) => t.id), ['a', 'b', 'c']);
});

test('TF8 keepProvince：切时间档后已选省不在新候选里 → 回落「全部省份」', () => {
  const options = [{ name: '湖北省', label: '湖北', count: 2 }];
  assert.equal(tf.keepProvince(options, '湖北省'), '湖北省', '候选里还有就保留');
  assert.equal(tf.keepProvince(options, '上海市'), '', '候选里没了就清空，不能留一个筛不出东西的条件');
  assert.equal(tf.keepProvince(options, ''), '');
  assert.equal(tf.keepProvince([], '湖北省'), '');
});

test('TF9 isFiltered / filterSummary：默认态不点亮筛选按钮', () => {
  assert.equal(tf.isFiltered({ period: 'week', province: '' }), false);
  assert.equal(tf.isFiltered({ period: 'month', province: '' }), true, '换时间档就算筛选中');
  assert.equal(tf.isFiltered({ period: 'week', province: '湖北省' }), true);
  assert.equal(tf.isFiltered({}), false, '空态＝默认');

  assert.equal(tf.filterSummary({ period: 'week', province: '' }), '本周');
  assert.equal(tf.filterSummary({ period: 'month', province: '湖北省' }), '本月 · 湖北');
  assert.equal(tf.filterSummary({ period: '2024', province: '上海市' }), '2024 年 · 上海');
});

test('TF10 shareTitle：条件与条数写进分享标题，超上限标「部分」', () => {
  assert.equal(tf.shareTitle({ period: 'week', province: '' }, 5, 5), '我的本周轨迹 · 5 条');
  assert.equal(tf.shareTitle({ period: '2024', province: '' }, 12, 12), '我的 2024 年轨迹 · 12 条');
  assert.equal(tf.shareTitle({ period: 'month', province: '湖北省' }, 72, 80), '我的本月轨迹（湖北） · 72 条（部分）');
});

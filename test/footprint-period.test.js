/**
 * 共享周期模块（miniprogram/utils/footprint-period.js）单测：
 * 列表页与统计页共用同一份自然月/自然年换算与文案，区间为 [from, to) 日期串。
 * 运行：npm test（node --test 自动发现）；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { RANGES, PICKER_COUNT, periodRange, periodLabelOf } = require(path.join(
  __dirname,
  '..',
  'miniprogram/utils/footprint-period.js',
));

const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

test('P1 月区间：自然月 [本月1日, 下月1日)，offset 往前推', () => {
  const now = new Date();
  const cur = periodRange('month', 0);
  assert.equal(cur.from, fmt(new Date(now.getFullYear(), now.getMonth(), 1)));
  assert.equal(cur.to, fmt(new Date(now.getFullYear(), now.getMonth() + 1, 1)));

  const prev = periodRange('month', 1);
  assert.equal(prev.from, fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
  assert.equal(prev.to, cur.from, '上一月的 to 等于本月的 from（左闭右开首尾相接）');
});

test('P2 年区间：自然年 [1月1日, 次年1月1日)，跨年翻页正确', () => {
  const y = new Date().getFullYear();
  const cur = periodRange('year', 0);
  assert.equal(cur.from, `${y}-01-01`);
  assert.equal(cur.to, `${y + 1}-01-01`);

  const prev = periodRange('year', 2);
  assert.equal(prev.from, `${y - 2}-01-01`);
  assert.equal(prev.to, `${y - 1}-01-01`);
});

test('P3 周期文案：月 → "YYYY年M月"（不补零），年 → "YYYY年"', () => {
  assert.equal(periodLabelOf('month', { from: '2026-09-01', to: '2026-10-01' }), '2026年9月');
  assert.equal(periodLabelOf('month', { from: '2026-12-01', to: '2027-01-01' }), '2026年12月');
  assert.equal(periodLabelOf('year', { from: '2026-01-01', to: '2027-01-01' }), '2026年');
});

test('P4 常量：三档 tab 顺序与抽屉选项数（月 12 / 年 5）', () => {
  assert.deepEqual(RANGES.map((r) => r.value), ['month', 'year', 'all']);
  assert.deepEqual(RANGES.map((r) => r.label), ['月', '年', '全部']);
  assert.deepEqual(PICKER_COUNT, { month: 12, year: 5 });
});

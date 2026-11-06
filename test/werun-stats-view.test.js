const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildOverview, buildTrend, buildDayItems, buildStepMetricCards } = require('../miniprogram/utils/werun-stats-view.js');

test('WSV-1 概况：总/日均用万，单日保留千分位；无数据最高单日为占位', () => {
  const o = buildOverview(
    { totalStep: 160659, avgStep: 53553, bestStep: 20188, bestDate: '2026-11-03', syncedDays: 3 },
    '2026-11-01',
    '2026-11-07',
  );
  assert.equal(o.totalText, '16.1万');
  assert.equal(o.avgText, '5.4万');
  assert.equal(o.bestText, '2万');
  assert.equal(o.bestDateText, '11/03');
  assert.equal(o.syncedDays, 3);
  assert.equal(o.rangeText, '2026/11/01 ~ 2026/11/07');

  const empty = buildOverview({ totalStep: 0, avgStep: 0, bestStep: 0, bestDate: '', syncedDays: 0 }, '2026-11-01', '2026-11-07');
  assert.equal(empty.bestText, '—');
  assert.equal(empty.bestDateText, '');
});

test('WSV-2 趋势：转成柱状图数据并给出按日/周/月文案', () => {
  const t = buildTrend([{ label: '11/05', step: 1200 }, { label: '11/06', step: 0 }], 'day');
  assert.deepEqual(t.data, [{ label: '11/05', value: 1200 }, { label: '11/06', value: 0 }]);
  assert.equal(t.subText, '按日');
  assert.equal(buildTrend([], 'week').subText, '按周');
  assert.equal(buildTrend([], 'month').subText, '按月');
});

test('WSV-3 每日明细：完整年月日 + 星期 + 千分位步数', () => {
  const rows = buildDayItems([{ date: '2026-11-06', weekday: '周五', step: 12345 }]);
  assert.deepEqual(rows, [{ date: '2026-11-06', dateText: '2026/11/06', weekday: '周五', stepText: '12,345' }]);
});

test('WSV-4 趋势变化四卡：总/日均/最高/同步天数，涨幅带箭头', () => {
  const cards = buildStepMetricCards(
    { totalStep: 30000, avgStep: 7500, bestStep: 12000, syncedDays: 4 },
    { totalStep: 20000, avgStep: 5000, bestStep: 8000, syncedDays: 4 },
  );
  assert.deepEqual(cards.map((c) => [c.label, c.value, c.unit]), [
    ['总步数', '3万', '步'],
    ['日均', '7,500', '步/天'],
    ['最高单日', '1.2万', '步'],
    ['同步天数', '4', '天'],
  ]);
  assert.equal(cards[0].diffText, '+50%');
  assert.equal(cards[0].dir, 'up');
  assert.equal(cards[0].arrowIcon, '/assets/icons/lucide-trending-up-green.png');
  assert.equal(cards[1].diffText, '+50%');
  assert.equal(cards[2].diffText, '+50%');
  assert.equal(cards[3].diffText, '0%', '天数相同给 0%');
  assert.equal(cards[3].dir, 'flat');
});

test('WSV-5 上一周期没数据：不给编百分比；两期都空则整段不出卡', () => {
  const cards = buildStepMetricCards(
    { totalStep: 30000, avgStep: 7500, bestStep: 12000, syncedDays: 4 },
    { totalStep: 0, avgStep: 0, bestStep: 0, syncedDays: 0 },
  );
  assert.equal(cards[0].diffText, '');
  assert.equal(cards[0].dir, 'none');
  assert.equal(cards[0].arrowIcon, '');
  assert.deepEqual(
    buildStepMetricCards(
      { totalStep: 0, avgStep: 0, bestStep: 0, syncedDays: 0 },
      { totalStep: 0, avgStep: 0, bestStep: 0, syncedDays: 0 },
    ),
    [],
  );
});

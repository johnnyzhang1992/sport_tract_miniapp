/**
 * 运动日历（utils/activity-calendar.js）。
 *
 * 参考 Keep 的月历：一周从周日开始、有运动的天打勾、跨月补位格置灰。
 * 数据来自 /stats/trend?days=365 的每日 count，所以日历只覆盖最近一年。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildMonthGrid, shiftMonth, compareMonth, WEEKDAYS } = require('../miniprogram/utils/activity-calendar.js');

const rows = (...days) => days.map(([date, count]) => ({ date, count }));

test('AC1 2026 年 10 月：10/1 是周四，首行补 4 格上月末尾', () => {
  const g = buildMonthGrid(rows(), 2026, 10, '2026-10-24');
  assert.equal(WEEKDAYS.join(''), '日一二三四五六');
  // 2026-10-01 是周四 → 偏移 4
  assert.deepEqual(
    g.weeks[0].map((c) => [c.day, c.inMonth]),
    [
      [27, false],
      [28, false],
      [29, false],
      [30, false],
      [1, true],
      [2, true],
      [3, true],
    ],
  );
  assert.equal(g.weeks.length, 5, '10 月 31 天 + 偏移 4 = 35 格整 5 行');
});

test('AC2 有运动的天打勾；补位格不参与当月累计', () => {
  const g = buildMonthGrid(
    rows(['2026-10-01', 1], ['2026-10-02', 2], ['2026-09-30', 1], ['2026-10-24', 1]),
    2026,
    10,
    '2026-10-24',
  );
  assert.equal(g.activeDays, 3, '9/30 是补位格，不能算进 10 月');
  const flat = g.weeks.flat();
  const byDay = (d) => flat.find((c) => c.inMonth && c.day === d);
  assert.equal(byDay(1).hasActivity, true);
  assert.equal(byDay(3).hasActivity, false);
  assert.equal(byDay(24).isToday, true);
  assert.equal(byDay(23).isToday, false);
  assert.equal(flat.find((c) => !c.inMonth && c.day === 30).hasActivity, true, '补位格仍按真实日期判断');
});

test('AC3 末行用下月开头补满（含跨年）', () => {
  const dec = buildMonthGrid(rows(), 2026, 12, '2026-12-01');
  assert.equal(dec.weeks.length * 7 % 7, 0);
  assert.equal(dec.weeks[0].length, 7);
  const last = dec.weeks[dec.weeks.length - 1];
  assert.equal(last.length, 7);
  assert.ok(last.some((c) => !c.inMonth), '12 月末行補 1 月的日子');
  // 12/31 是周四（2026），末行补到 1/2
  assert.deepEqual(
    last.map((c) => c.day),
    [27, 28, 29, 30, 31, 1, 2],
  );
});

test('AC4 2 月与闰年：2028-02 有 29 天；2026-02 是 28 天', () => {
  const leap = buildMonthGrid(rows(), 2028, 2, '2028-02-01');
  assert.ok(leap.weeks.flat().some((c) => c.inMonth && c.day === 29), '闰年 2 月 29 日');
  const normal = buildMonthGrid(rows(), 2026, 2, '2026-02-01');
  assert.equal(normal.weeks.flat().filter((c) => c.inMonth).length, 28);
});

test('AC5 翻月：跨年进位/退位，比较大小正确', () => {
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
  assert.ok(compareMonth({ year: 2025, month: 12 }, { year: 2026, month: 1 }) < 0);
  assert.equal(compareMonth({ year: 2026, month: 10 }, { year: 2026, month: 10 }), 0);
});

test('AC6 count 为 0 或缺字段不算运动；空 rows 也不炸', () => {
  const g = buildMonthGrid([{ date: '2026-10-05', count: 0 }, { date: '2026-10-06' }], 2026, 10, '2026-10-01');
  assert.equal(g.activeDays, 0);
  assert.equal(buildMonthGrid(null, 2026, 10, '2026-10-01').activeDays, 0);
});

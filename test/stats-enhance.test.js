/**
 * 统计页增强：近 90 天 vs 近 365 天日均对比、里程碑奖杯墙。
 * 都是纯函数，边界口径直接写进用例。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildTrendCompare } = require('../miniprogram/utils/trend-compare.js');
const { buildTrophies } = require('../miniprogram/utils/trophy.js');

/** 造 n 天数据：valueFn(i) 返回当天距离（米），按时间升序 */
function days(n, valueFn) {
  return Array.from({ length: n }, (_, i) => ({
    date: `d${i}`,
    distance: valueFn(i),
    duration: 0,
    count: 0,
  }));
}

test('TC1 近 90 天比过去一年更活跃：日均按各自天数算，方向 up', () => {
  // 最后 90 天每天 10km，之前 275 天空档
  const rows = days(365, (i) => (i >= 275 ? 10000 : 0));
  const c = buildTrendCompare(rows);
  assert.ok(c, '有数据应返回对比');
  assert.equal(c.avg90, 10);
  assert.equal(c.avg365, 2.5, '900km / 365 天');
  assert.equal(c.dir, 'up');
  assert.ok(c.diffPct > 300, `差异应明显为正，实际 ${c.diffPct}`);
});

test('TC2 前后一年强度一致：0% 视为持平', () => {
  const c = buildTrendCompare(days(365, () => 2000));
  assert.equal(c.avg90, 2);
  assert.equal(c.avg365, 2);
  assert.equal(c.diffPct, 0);
  assert.equal(c.dir, 'flat');
});

test('TC3 全空数据不展示对比', () => {
  assert.equal(buildTrendCompare(days(365, () => 0)), null);
  assert.equal(buildTrendCompare([]), null);
});

test('TC4 数据不足 365 天：分母取实际返回天数，不硬按 365', () => {
  const c = buildTrendCompare(days(90, () => 1000));
  assert.equal(c.avg90, 1);
  assert.equal(c.avg365, 1, '90 行数据 / 90 天');
  assert.equal(c.dir, 'flat');
});

test('TC5 幅度很小时不显示箭头抖动（±5% 内视为持平）', () => {
  // 后 90 天每天 1.1km，其余 1km：差异约 10%，应 up
  const c1 = buildTrendCompare(days(365, (i) => (i >= 275 ? 1100 : 1000)));
  assert.equal(c1.dir, 'up');
  // 1.02 倍 → 约 2%，应 flat
  const c2 = buildTrendCompare(days(365, (i) => (i >= 275 ? 1020 : 1000)));
  assert.equal(c2.dir, 'flat');
});

test('TR1 奖杯墙固定五项，已达成的带轨迹 id', () => {
  const list = buildTrophies([
    { key: '1k', id: 'a', sec: 280, type: 'running' },
    { key: '5k', id: 'b', sec: 1500, type: 'running' },
  ]);
  assert.deepEqual(
    list.map((t) => t.key),
    ['1k', '5k', '10k', 'half', 'full'],
  );
  assert.deepEqual(
    list.map((t) => t.unlocked),
    [true, true, false, false, false],
  );
  assert.equal(list[0].id, 'a');
  assert.equal(list[0].sec, 280);
  assert.equal(list[2].id, '');
  assert.equal(list[2].sec, 0);
});

test('TR2 空数据全部未解锁；未知 key 忽略', () => {
  assert.ok(buildTrophies([]).every((t) => !t.unlocked));
  const list = buildTrophies([{ key: 'mile', id: 'x', sec: 1 }]);
  assert.equal(list.length, 5);
  assert.ok(list.every((t) => !t.unlocked));
});

test('TR3 奖杯附解锁要求与保持天数', () => {
  const now = Date.UTC(2026, 9, 23);
  const DAY = 86400000;
  const list = buildTrophies(
    [{ key: '5k', id: 'b', sec: 1500, type: 'running', startTime: now - 80 * DAY }],
    now,
  );
  const byKey = new Map(list.map((t) => [t.key, t]));
  assert.equal(byKey.get('5k').heldDays, 80);
  assert.equal(byKey.get('5k').startTime, now - 80 * DAY);
  assert.equal(byKey.get('5k').requirementText, '完成 5 km');
  assert.equal(byKey.get('1k').requirementText, '完成 1 km');
  assert.equal(byKey.get('10k').requirementText, '完成 10 km');
  assert.equal(byKey.get('half').requirementText, '完成 21.1 km');
  assert.equal(byKey.get('full').requirementText, '完成 42.2 km');
});

test('TR4 保持天数：未来时间/缺失时间按 0，不出现负数', () => {
  const now = Date.UTC(2026, 9, 23);
  const DAY = 86400000;
  const list = buildTrophies(
    [
      { key: '1k', id: 'a', sec: 300, type: 'running', startTime: now + DAY },
      { key: '5k', id: 'b', sec: 1500, type: 'running' },
    ],
    now,
  );
  assert.equal(list[0].heldDays, 0);
  assert.equal(list[1].heldDays, 0);
});

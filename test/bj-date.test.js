/**
 * 东八区边界工具（2026-11-06）：
 * 报告页/年度报告的周期区间必须与设备时区无关——`new Date(y,m,d)` 走本地时区，
 * 非 +8 设备会把自然日/周/月算偏，服务端按东八区换算后边界那天会被算进错误周期。
 * 运行：node --test test/bj-date.test.js
 * 时区无关性用 `TZ=America/New_York node --test test/bj-date.test.js` 复跑验证。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bjDate, bjDayStart, bjMid, bjParts, bjWeekStart } = require('../miniprogram/utils/bj-date.js');

const DAY = 86400000;

test('BJ1 bjMid：东八区零点换算（2026-01-01 00:00 +08 = 2025-12-31T16:00Z）', () => {
  assert.equal(new Date(bjMid(2026, 1, 1)).toISOString(), '2025-12-31T16:00:00.000Z');
  assert.equal(bjDate(bjMid(2026, 11, 6)), '2026-11-06');
  // 月份越界自动进位（12 月 +1 → 次年 1 月）
  assert.equal(bjDate(bjMid(2026, 13, 1)), '2027-01-01');
  assert.equal(bjDate(bjMid(2026, 0, 1)), '2025-12-01');
});

test('BJ2 bjWeekStart：东八区自然周从周一起算，与设备时区无关', () => {
  // 2026-11-06 00:30 (+08) 是周四 → 本周一 11-02
  const sample = Date.UTC(2026, 10, 5, 16, 30);
  assert.equal(bjDate(bjWeekStart(sample)), '2026-11-02');
  // 周日本身应归到本周（不是下周）
  const sunday = bjMid(2026, 11, 8) + 12 * 3600000;
  assert.equal(bjParts(sunday).dow, 0, '构造值是周日');
  assert.equal(bjDate(bjWeekStart(sunday)), '2026-11-02', '周日仍属于本周');
  // 周一当天
  assert.equal(bjDate(bjWeekStart(bjMid(2026, 11, 9) + 3600000)), '2026-11-09');
});

test('BJ3 bjDayStart：跨月/跨年边界（东八区 0 点）', () => {
  // 东八区 2026-12-31 23:59 → 当日 0 点仍是 2026-12-31
  assert.equal(bjDate(bjDayStart(bjMid(2026, 12, 31) + DAY - 1)), '2026-12-31');
  // 东八区 2027-01-01 00:00 → 新的一天
  assert.equal(bjDate(bjDayStart(bjMid(2027, 1, 1))), '2027-01-01');
});

test('BJ4 年度区间：东八区自然年，不受设备时区影响', () => {
  const from = bjMid(2026, 1, 1);
  const to = bjMid(2027, 1, 1);
  assert.equal(bjDate(from), '2026-01-01');
  assert.equal(bjDate(to - 1), '2026-12-31', 'to 是排他边界，减 1ms 落在 12-31');
  assert.equal((to - from) / DAY, 365, '2026 不是闰年');
});

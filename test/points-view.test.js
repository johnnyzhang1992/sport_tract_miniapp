/**
 * 积分页展示纯函数（miniprogram/utils/points-view.js）单测：
 * 签到七格条的完成态/当前格/日期文案，以及每日任务行的可点状态。
 * 运行：node --test test/points-view.test.js；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSigninStrip, buildTaskRows } = require('../miniprogram/utils/points-view.js');

test('PV1 连续 7 天后七格全勾，文案每日 7 分', () => {
  const rows = buildSigninStrip({ todaySigned: true, streakDay: 9, todayReward: 7, nextReward: 7 }, Date.UTC(2026, 9, 24, 2));
  assert.equal(rows.length, 7);
  assert.ok(rows.every((r) => r.done));
});

test('PV2 今天未签：当前格为 streak+1', () => {
  const rows = buildSigninStrip({ todaySigned: false, streakDay: 3, nextReward: 4 }, Date.UTC(2026, 9, 24, 2));
  assert.equal(rows[2].done, true);
  assert.equal(rows[3].current, true);
  assert.equal(rows[3].sub, '今天');
});

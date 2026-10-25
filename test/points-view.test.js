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

test('PV3 任务行透传文案，只有 claimable 可点', () => {
  const rows = buildTaskRows([
    { key: 'daily_video', title: '每日看视频', points: 5, status: 'claimable', actionText: '去观看' },
    { key: 'daily_activity', title: '每日运动', points: 5, status: 'locked', actionText: '去运动' },
    { key: 'profile', title: '完善资料', points: 10, status: 'claimed', actionText: '已领取' },
  ]);
  assert.deepEqual(
    rows.map((r) => [r.actionText, r.disabled]),
    [['去观看', false], ['去运动', true], ['已领取', true]],
  );
});

test('PV4 连签已满 7 天但今天没签：没有格子既 done 又 current', () => {
  for (const streakDay of [7, 9]) {
    const rows = buildSigninStrip({ todaySigned: false, streakDay, nextReward: 7 }, Date.UTC(2026, 9, 24, 2));
    assert.ok(rows.every((r) => r.done), `streakDay=${streakDay} 七格应全勾`);
    assert.equal(rows.some((r) => r.current), false, `streakDay=${streakDay} 不应再有当前格`);
    assert.equal(rows[6].current, false);
    assert.equal(rows.some((r) => r.sub === '今天'), false, `streakDay=${streakDay} 不应标「今天」`);
  }
});

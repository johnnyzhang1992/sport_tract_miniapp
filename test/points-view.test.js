/**
 * 积分页展示纯函数（miniprogram/utils/points-view.js）单测：
 * 签到七格条的完成态/当前格/日期文案、每日任务行的可点状态与「未完成在前」，以及道具卡字段。
 * 运行：node --test test/points-view.test.js；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSigninStrip, buildTaskRows, buildItemCards } = require('../miniprogram/utils/points-view.js');

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
    { key: 'profile', title: '完善资料', points: 10, status: 'claimed', actionText: '已领取' },
    { key: 'daily_video', title: '每日看视频', points: 5, status: 'claimable', actionText: '去观看' },
    { key: 'daily_activity', title: '每日运动', points: 5, status: 'locked', actionText: '去运动' },
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

test('PV5 未完成的排前面、已领取沉底，两组各保持接口原序', () => {
  const mk = (key, status) => ({ key, title: key, points: 1, status, actionText: status });
  const rows = buildTaskRows([
    mk('newbie_profile', 'claimed'),
    mk('daily_activity', 'locked'),
    mk('newbie_first_activity', 'claimed'),
    mk('daily_video', 'claimable'),
    mk('newbie_first_import', 'expired'),
  ]);
  assert.deepEqual(
    rows.map((r) => r.key),
    ['daily_activity', 'daily_video', 'newbie_first_import', 'newbie_profile', 'newbie_first_activity'],
    'locked/claimable/expired 都算未完成，留在前面；只有 claimed 沉底',
  );
});

test('PV6 道具卡：图位取名称首字，价格/有效期原样带出', () => {
  const cards = buildItemCards([
    { key: 'makeup_card', name: '补签卡', subtitle: '恢复连续打卡记录', price: 200, validDays: 30 },
  ]);
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0], {
    key: 'makeup_card', name: '补签卡', subtitle: '恢复连续打卡记录', price: 200, validDays: 30, glyph: '补',
  });
  assert.deepEqual(buildItemCards(undefined), [], '接口没下发商品表时给空数组，wxml 的 wx:if 才不会红');
});

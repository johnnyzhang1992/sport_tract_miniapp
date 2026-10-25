/**
 * 积分页展示纯函数（miniprogram/utils/points-view.js）单测：
 * 七格只做「服务端 cells → 显示」的格式化（状态 → 圈里字，dateKey → 今天/明天/MM.DD），
 * 补签胶囊每个 makeup 格一颗、分值兜底，shiftDateKey 是纯 UTC 日期算术。
 * 位置/分值/可补判定全部由服务端决定（2026-10-25 补签窗口改版，spec §5.1），客户端不再自推。
 * 运行：node --test test/points-view.test.js；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSigninStrip, buildMakeupChips, shiftDateKey, buildTaskRows, buildItemCards,
} = require('../miniprogram/utils/points-view.js');

/** 按「起点 dateKey + 每天 [state, streakDay(, todayRewardAfter)]」造 cells；reward 走服务端口径 min(streakDay,7) */
const mkCells = (startKey, days) => days.map(([state, streakDay, after], i) => {
  const c = { dateKey: shiftDateKey(startKey, i), state, streakDay, reward: state === 'missed' ? 0 : Math.min(streakDay, 7) };
  if (after !== undefined) c.todayRewardAfter = after;
  return c;
});

test('PV1 连签 7 天后七格全勾：长连签尾窗分值全为 7，已签的今天那格 sub 是「今天」', () => {
  const strip = buildSigninStrip(mkCells('2026-10-18', [
    ['signed', 8], ['signed', 9], ['signed', 10], ['signed', 11], ['signed', 12], ['signed', 13], ['signed', 14],
  ]), '2026-10-24');
  assert.equal(strip.length, 7);
  assert.deepEqual(strip.map((s) => s.dot), ['✓', '✓', '✓', '✓', '✓', '✓', '✓']);
  assert.deepEqual(strip.map((s) => s.reward), [7, 7, 7, 7, 7, 7, 7], 'reward 原样带出 cells 的名义分，客户端不自算');
  assert.deepEqual(strip.map((s) => s.sub), ['10.18', '10.19', '10.20', '10.21', '10.22', '10.23', '今天']);
});

test('PV2 今天未签：today 格 dot 为 +分值；「今天/明天」按 dateKey 比对，不靠数组下标', () => {
  // 起点被 runStart 挪到 10.22，今天(10.25)在第 4 格而不是第 7 格——这正是不能按下标推的原因
  const strip = buildSigninStrip(mkCells('2026-10-22', [
    ['signed', 1], ['signed', 2], ['signed', 3],
    ['today', 4], ['future', 5], ['future', 6], ['future', 7],
  ]), '2026-10-25');
  assert.equal(strip[3].dot, '+4');
  assert.equal(strip[3].sub, '今天');
  assert.equal(strip[4].dot, '+5');
  assert.equal(strip[4].sub, '明天');
  assert.equal(strip[6].sub, '10.28', '第 7 格不是今天');
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

test('PV4 格子输出只有 {dateKey,state,dot,sub,reward}：混合状态逐个按服务端格式化，done/current 收口后不再回来', () => {
  const strip = buildSigninStrip(mkCells('2026-10-19', [
    ['missed', 0], ['signed', 5], ['makeup', 6, 7],
    ['today', 13], ['future', 14], ['future', 15], ['future', 16],
  ]), '2026-10-22');
  assert.deepEqual(strip, [
    { dateKey: '2026-10-19', state: 'missed', dot: '未', sub: '10.19', reward: 0 },
    { dateKey: '2026-10-20', state: 'signed', dot: '✓', sub: '10.20', reward: 5 },
    { dateKey: '2026-10-21', state: 'makeup', dot: '补', sub: '10.21', reward: 6 },
    // today/future 的 dot 用 reward（streakDay 13 封顶成 7 分），不是把 streakDay 直接印出去
    { dateKey: '2026-10-22', state: 'today', dot: '+7', sub: '今天', reward: 7 },
    { dateKey: '2026-10-23', state: 'future', dot: '+7', sub: '明天', reward: 7 },
    { dateKey: '2026-10-24', state: 'future', dot: '+7', sub: '10.24', reward: 7 },
    { dateKey: '2026-10-25', state: 'future', dot: '+7', sub: '10.25', reward: 7 },
  ]);
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

test('PV7 buildSigninStrip 只格式化不推导：状态/圈里字/副标题都来自 cells', () => {
  const cells = [
    { dateKey: '2026-10-19', state: 'makeup', streakDay: 1, reward: 1, todayRewardAfter: 1 },
    { dateKey: '2026-10-20', state: 'signed', streakDay: 1, reward: 1 },
    { dateKey: '2026-10-21', state: 'signed', streakDay: 2, reward: 2 },
    { dateKey: '2026-10-22', state: 'missed', streakDay: 0, reward: 0 },
    { dateKey: '2026-10-23', state: 'signed', streakDay: 3, reward: 3 },
    { dateKey: '2026-10-24', state: 'makeup', streakDay: 4, reward: 4, todayRewardAfter: 6 },
    { dateKey: '2026-10-25', state: 'today', streakDay: 1, reward: 1 },
  ];
  const strip = buildSigninStrip(cells, '2026-10-25');
  assert.deepEqual(strip.map((s) => s.dot), ['补', '✓', '✓', '未', '✓', '补', '+1']);
  assert.equal(strip[6].sub, '今天');
  assert.equal(strip[0].sub, '10.19');
});

test('PV8 buildMakeupChips：每个可补日一颗胶囊，无卡时文案变「去兑换」', () => {
  const cells = [{ dateKey: '2026-10-24', state: 'makeup', streakDay: 5, reward: 5, todayRewardAfter: 6 }];
  assert.deepEqual(buildMakeupChips(cells, 2), [
    // 日期一律 MM.DD，与七格 sub 同一格式（md() 产出），别一处 10-24 一处 10.24
    { dateKey: '2026-10-24', label: '补签 10.24', sub: '剩 2 张卡', hasCard: true, todayRewardAfter: 6 },
  ]);
  assert.equal(buildMakeupChips(cells, 0)[0].hasCard, false);
  assert.equal(buildMakeupChips(cells, 0)[0].sub, '去兑换');
  assert.deepEqual(buildMakeupChips([], 3), [], '没有可补格时不出现入口');
});

test('PV9 只有 makeup 格出胶囊：missed/today/future 都不给补签入口（与七格可补判定同源）', () => {
  const cells = [
    { dateKey: '2026-10-21', state: 'missed', streakDay: 0, reward: 0 },
    { dateKey: '2026-10-22', state: 'makeup', streakDay: 2, reward: 2, todayRewardAfter: 5 },
    { dateKey: '2026-10-23', state: 'today', streakDay: 1, reward: 1 },
    { dateKey: '2026-10-24', state: 'future', streakDay: 2, reward: 2 },
  ];
  assert.deepEqual(buildMakeupChips(cells, 1), [
    { dateKey: '2026-10-22', label: '补签 10.22', sub: '剩 1 张卡', hasCard: true, todayRewardAfter: 5 },
  ]);
  // 服务端没带 todayRewardAfter 时落 0：弹窗文案直接拼它，不能是 undefined
  assert.equal(
    buildMakeupChips([{ dateKey: '2026-10-22', state: 'makeup', streakDay: 1, reward: 1 }], 1)[0].todayRewardAfter,
    0,
  );
});

test('PV10 shiftDateKey 纯 UTC 算术：不因本地时区漂日，跨月跨年正确', () => {
  assert.equal(shiftDateKey('2026-10-25', 1), '2026-10-26');
  assert.equal(shiftDateKey('2026-10-25', -6), '2026-10-19');
  assert.equal(shiftDateKey('2026-10-31', 1), '2026-11-01');
  assert.equal(shiftDateKey('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDateKey('2027-01-01', -1), '2026-12-31');
});

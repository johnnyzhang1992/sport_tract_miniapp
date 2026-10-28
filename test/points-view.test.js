/**
 * 积分页展示纯函数（miniprogram/utils/points-view.js）单测：
 * 七格只做「服务端 cells → 显示」的格式化（状态 → 圈里字，dateKey → 今天/明天/MM.DD），
 * 补签入口就是七格里 state==='makeup' 的那格（不再另起胶囊行），
 * 弹窗要用的 todayRewardAfter 从 cells 原样带出，shiftDateKey 是纯 UTC 日期算术。
 * 位置/分值/可补判定全部由服务端决定（2026-10-25 补签窗口改版，spec §5.1），客户端不再自推。
 * 运行：node --test test/points-view.test.js；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSigninStrip, shiftDateKey, buildTaskRows, buildItemCards,
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
  assert.deepEqual(strip.map((s) => s.dot), ['+7', '+7', '+7', '+7', '+7', '+7', '+7'], '已签格圈里是实得分（名义分）');
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

test('PV3 任务分组：newbie_ 前缀归新手卡，其余归每日卡；组内未完成在前', () => {
  const g = buildTaskRows([
    { key: 'profile', title: '完善资料', points: 10, status: 'claimed', actionText: '已领取' },
    { key: 'daily_video', title: '每日看视频', points: 5, status: 'claimable', actionText: '去观看' },
    { key: 'daily_activity', title: '每日运动', points: 5, status: 'locked', actionText: '去运动' },
  ]);
  // 'profile' 不带 newbie_ 前缀 → 落入每日卡（判定只认前缀，与真实任务键一致）
  assert.deepEqual(
    g.dailyTasks.map((r) => [r.actionText, r.disabled]),
    [['去观看', false], ['去运动', true], ['已领取', true]],
  );
  assert.equal(g.onceTasks.length, 0);
});

test('PV3b newbie_ 前缀归新手卡', () => {
  const g = buildTaskRows([{ key: 'newbie_profile', title: '完善资料', points: 5, status: 'claimable', actionText: '领取' }]);
  assert.equal(g.onceTasks.length, 1);
  assert.equal(g.dailyTasks.length, 0);
});

test('PV4 格子输出 {dateKey,state,dot,sub,reward,todayRewardAfter}：混合状态逐个按服务端格式化，done/current 收口后不再回来', () => {
  const strip = buildSigninStrip(mkCells('2026-10-19', [
    ['missed', 0], ['signed', 5], ['makeup', 6, 7],
    ['today', 13], ['future', 14], ['future', 15], ['future', 16],
  ]), '2026-10-22');
  assert.deepEqual(strip, [
    { dateKey: '2026-10-19', state: 'missed', dot: '未', sub: '10.19', reward: 0, todayRewardAfter: 0 },
    { dateKey: '2026-10-20', state: 'signed', dot: '+5', sub: '10.20', reward: 5, todayRewardAfter: 0 },
    { dateKey: '2026-10-21', state: 'makeup', dot: '补', sub: '10.21', reward: 6, todayRewardAfter: 7 },
    // today/future 的 dot 用 reward（streakDay 13 封顶成 7 分），不是把 streakDay 直接印出去
    { dateKey: '2026-10-22', state: 'today', dot: '+7', sub: '今天', reward: 7, todayRewardAfter: 0 },
    { dateKey: '2026-10-23', state: 'future', dot: '+7', sub: '明天', reward: 7, todayRewardAfter: 0 },
    { dateKey: '2026-10-24', state: 'future', dot: '+7', sub: '10.24', reward: 7, todayRewardAfter: 0 },
    { dateKey: '2026-10-25', state: 'future', dot: '+7', sub: '10.25', reward: 7, todayRewardAfter: 0 },
  ]);
});

test('PV5 未完成的排前面、已领取沉底（分卡后各组内同规则）', () => {
  const mk = (key, status) => ({ key, title: key, points: 1, status, actionText: status });
  const g = buildTaskRows([
    mk('newbie_profile', 'claimed'),
    mk('daily_activity', 'locked'),
    mk('newbie_first_activity', 'claimed'),
    mk('daily_video', 'claimable'),
    mk('newbie_first_import', 'expired'),
  ]);
  assert.deepEqual(
    g.onceTasks.map((r) => r.key),
    ['newbie_first_import'],
    'onceTasks 只收未完成行：claimed 的新手行不再展示（全部 claimed → 整卡隐藏）',
  );
  assert.deepEqual(
    g.dailyTasks.map((r) => r.key),
    ['daily_activity', 'daily_video'],
    'claimed 的新手行不沉入每日组——已完成的任务不展示',
  );
});

test('PV6 道具卡：图位取名称首字，价格/有效期原样带出', () => {
  const cards = buildItemCards([
    { key: 'makeup_card', name: '补签卡', subtitle: '恢复连续打卡记录', price: 200, validDays: 30 },
  ]);
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0], {
    key: 'makeup_card', name: '补签卡', subtitle: '恢复连续打卡记录', price: 200, priceText: '200', validDays: 30,
    validText: '30 天有效', stockText: '', metaText: '30 天有效', glyph: '补', imageUrl: '',
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
  assert.deepEqual(strip.map((s) => s.dot), ['补', '+1', '+2', '未', '+3', '补', '+1']);
  assert.equal(strip[6].sub, '今天');
  assert.equal(strip[0].sub, '10.19');
});

test('PV8 补签入口就是七格里的 makeup 格：todayRewardAfter 原样带出，缺失落 0', () => {
  const cells = [{ dateKey: '2026-10-24', state: 'makeup', streakDay: 5, reward: 5, todayRewardAfter: 6 }];
  const strip = buildSigninStrip(cells, '2026-10-25');
  assert.equal(strip.length, 1);
  assert.equal(strip[0].state, 'makeup', '可补判定只看 state，页面据此把这一格做成入口');
  assert.equal(strip[0].dot, '补', '可补格的圈里字是「补」');
  assert.equal(strip[0].sub, '10.24', '日期一律 MM.DD，与七格其它格同一格式');
  // 弹窗要拼「补完今天可拿 N 分」：值由服务端下发，客户端不推算；没下发时落 0，不能是 undefined
  assert.equal(strip[0].todayRewardAfter, 6);
  assert.equal(
    buildSigninStrip([{ dateKey: '2026-10-22', state: 'makeup', streakDay: 1, reward: 1 }], '2026-10-25')[0].todayRewardAfter,
    0,
  );
});

test('PV9 只有 makeup 格是补签入口：missed/today/future 都不给（与七格可补判定同源）', () => {
  const cells = [
    { dateKey: '2026-10-21', state: 'missed', streakDay: 0, reward: 0 },
    { dateKey: '2026-10-22', state: 'makeup', streakDay: 2, reward: 2, todayRewardAfter: 5 },
    { dateKey: '2026-10-23', state: 'today', streakDay: 1, reward: 1 },
    { dateKey: '2026-10-24', state: 'future', streakDay: 2, reward: 2 },
  ];
  const strip = buildSigninStrip(cells, '2026-10-23');
  assert.deepEqual(
    strip.filter((s) => s.state === 'makeup').map((s) => s.dateKey),
    ['2026-10-22'],
    '只有 makeup 格能补签；missed 断超过窗口、today/future 未到期，都不给入口',
  );
  assert.deepEqual(strip.map((s) => s.dot), ['未', '补', '+1', '+2']);
});

test('PV10 shiftDateKey 纯 UTC 算术：不因本地时区漂日，跨月跨年正确', () => {
  assert.equal(shiftDateKey('2026-10-25', 1), '2026-10-26');
  assert.equal(shiftDateKey('2026-10-25', -6), '2026-10-19');
  assert.equal(shiftDateKey('2026-10-31', 1), '2026-11-01');
  assert.equal(shiftDateKey('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDateKey('2027-01-01', -1), '2026-12-31');
});

test('PV9 每日多次任务带出剩余次数：看视频 3 次递减，领满/老接口都不显示副行', () => {
  const g = buildTaskRows([
    { key: 'daily_video', title: '观看广告视频', points: 5, status: 'claimable', actionText: '去观看', times: 3, timesLeft: 2 },
    { key: 'daily_activity', title: '运动记录', points: 1, status: 'locked', actionText: '去运动', times: 1, timesLeft: 1 },
  ]);
  assert.deepEqual(g.dailyTasks.map((r) => [r.times, r.timesLeft, r.timesText]), [
    [3, 2, '今日还剩 2 次'],
    [1, 1, ''],
  ]);

  // 领满：服务端给 claimed + timesLeft 0，副行不显示（按钮已经写「已领取」）
  const done = buildTaskRows([{ key: 'daily_video', title: '观看广告视频', points: 5, status: 'claimed', actionText: '已领取', times: 3, timesLeft: 0 }]);
  assert.equal(done.dailyTasks[0].timesText, '');

  // 老接口缺字段：按 1 次处理，不显示副行
  const legacy = buildTaskRows([{ key: 'daily_video', title: '观看广告视频', points: 5, status: 'claimable', actionText: '去观看' }]);
  assert.deepEqual([legacy.dailyTasks[0].times, legacy.dailyTasks[0].timesLeft, legacy.dailyTasks[0].timesText], [1, 1, '']);
});

test('PV11 道具卡价格走千分位：与详情页按钮 28,900 同口径，不出现 28900', () => {
  const cards = buildItemCards([
    { key: 'mi_band_11', name: '小米手环11标准版', subtitle: '', price: 28900, validDays: 30 },
    { key: 'makeup_card', name: '补签卡', subtitle: '', price: 200, validDays: 30 },
  ]);
  assert.deepEqual(cards.map((c) => c.priceText), ['28,900', '200']);
});

test('PV12 道具卡有效期/库存成一行 meta：有效期不再跟副标题挤在一行折断', () => {
  const cards = buildItemCards([
    { key: 'makeup_card', name: '补签卡', subtitle: '恢复连续打卡记录', price: 200, validDays: 30, stockLeft: null },
    { key: 'mi_band_11', name: '小米手环11标准版', subtitle: '24 小时心率与血氧', price: 28900, validDays: 30, stockLeft: 9997 },
    // 老接口没下发 stockLeft：只显示有效期，别瞎猜「不限量」
    { key: 'ad_free_7d', name: '免广告卡', subtitle: '', price: 200, validDays: 30 },
  ]);
  assert.deepEqual(cards.map((c) => c.validText), ['30 天有效', '30 天有效', '30 天有效']);
  assert.deepEqual(cards.map((c) => c.stockText), ['不限量', '剩余 9,997 件', '']);
  assert.deepEqual(cards.map((c) => c.metaText), ['30 天有效 · 不限量', '30 天有效 · 剩余 9,997 件', '30 天有效']);
  // 副标题保持原样，不再被拼上有效期
  assert.equal(cards[1].subtitle, '24 小时心率与血氧');
});

test('PV13 道具卡透传服务端签名图链：有图给图、缺字段给空串（端上据此回落到首字占位）', () => {
  const cards = buildItemCards([
    { key: 'ad_free_7d', name: '免广告卡·7 天', subtitle: '', price: 200, validDays: 30, imageUrl: 'https://oss/x.png?sig=1' },
    { key: 'makeup_card', name: '补签卡', subtitle: '', price: 200, validDays: 30 },
  ]);
  assert.equal(cards[0].imageUrl, 'https://oss/x.png?sig=1', '签名链原样透传，端上不自己拼 OSS 参数');
  assert.equal(cards[1].imageUrl, '', '老接口没下发 imageUrl 时给空串，wxml 的 wx:if 才不会拿到 undefined 判断');
  assert.equal(cards[1].glyph, '补', '没图仍有首字占位');
});

/**
 * 一起运动活动（campaign）纯函数单测（miniprogram/utils/campaign.js）。
 * 状态 / 可见性标签只住这个模块（R22）：首页区块、列表页、创建/详情页都从这里取文案，别在页面里再抄一份。
 * 运行：npm test；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { statusLabel, visibilityLabel, fmtRange, joinCta, fmtPanel } = require('../miniprogram/utils/campaign.js');

test('CU1 状态/可见性标签', () => {
  assert.equal(statusLabel('active'), '进行中');
  assert.equal(statusLabel('ended'), '已结束');
  assert.equal(statusLabel('dissolved'), '已解散');
  assert.equal(visibilityLabel('private'), '隐私');
});

test('CU2 活动时间范围按东八区日期显示', () => {
  // startAt = 东八区 2026-10-01 00:00
  const start = Date.UTC(2026, 8, 30, 16, 0, 0);
  // endAt = 东八区 2026-10-08 00:00（= 结束日 10-07 的 24:00，左闭右开）；展示要减 1ms 回到 10-07
  const end = Date.UTC(2026, 9, 7, 16, 0, 0);
  assert.equal(fmtRange(start, end), '10-01 ~ 10-07');
});

test('CU3 加入按钮：公开=加入活动，隐私=申请加入', () => {
  assert.deepEqual(joinCta({ myState: 'none', canJoin: true, status: 'active', visibility: 'public' }), { text: '加入活动', disabled: false });
  assert.deepEqual(joinCta({ myState: 'none', canJoin: true, status: 'active', visibility: 'private' }), { text: '申请加入', disabled: false });
});

test('CU4 已在队 → 无加入按钮；待审/被踢/已满/已结束 → 按钮禁用且有对应文案', () => {
  assert.equal(joinCta({ myState: 'joined', canJoin: false, status: 'active', visibility: 'public' }), null);
  assert.deepEqual(joinCta({ myState: 'pending', canJoin: false, status: 'active', visibility: 'private' }), { text: '等待发起人同意', disabled: true });
  assert.deepEqual(joinCta({ myState: 'removed', canJoin: false, status: 'active', visibility: 'private' }), { text: '你已被移出该活动', disabled: true });
  assert.deepEqual(joinCta({ myState: 'none', canJoin: false, status: 'active', visibility: 'public' }), { text: '人数已满', disabled: true });
  assert.deepEqual(joinCta({ myState: 'none', canJoin: false, status: 'ended', visibility: 'public' }), { text: '活动已结束', disabled: true });
});

test('CU5 已解散 → 按钮禁用（未加入视角）', () => {
  assert.deepEqual(joinCta({ myState: 'none', canJoin: true, status: 'dissolved', visibility: 'public' }), { text: '活动已解散', disabled: true });
});

test('CU6 汇总格式化：列表 DTO 的 myStats 没有 streak 也不炸（只有详情 myPanel 带 streak）', () => {
  // 列表卡片 myStats = { count, distance, duration }，缺 streak 时归 0
  assert.deepEqual(fmtPanel({ count: 3, distance: 12340, duration: 600 }), {
    countText: '3',
    streakText: '0',
    distanceText: '12.34',
    durationText: '10min',
  });
  // 详情 myPanel 带连续天数时正常展示
  assert.deepEqual(fmtPanel({ count: 1, streak: 5, distance: 5000, duration: 3720 }), {
    countText: '1',
    streakText: '5',
    distanceText: '5.00',
    durationText: '1h2m',
  });
  // 全空（新活动/无数据）：零值成串，不产生 undefined
  assert.deepEqual(fmtPanel({}), {
    countText: '0',
    streakText: '0',
    distanceText: '0.00',
    durationText: '0min',
  });
});

test('CU7 已退出且可再参加 → 「重新加入」/「重新申请」', () => {
  assert.deepEqual(joinCta({ myState: 'left', canJoin: true, status: 'active', visibility: 'public' }), { text: '重新加入', disabled: false });
  assert.deepEqual(joinCta({ myState: 'left', canJoin: true, status: 'active', visibility: 'private' }), { text: '重新申请', disabled: false });
});

test('CU8 已退出但不可再参加（人数已满）→ 仍落「人数已满」，不放行', () => {
  assert.deepEqual(joinCta({ myState: 'left', canJoin: false, status: 'active', visibility: 'public' }), { text: '人数已满', disabled: true });
});

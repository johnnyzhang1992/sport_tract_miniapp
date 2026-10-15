/**
 * 一起运动活动（campaign）纯函数单测（miniprogram/utils/campaign.js）。
 * 状态 / 可见性标签只住这个模块（R22）：首页区块、列表页、创建/详情页都从这里取文案，别在页面里再抄一份。
 * 运行：npm test；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { statusLabel, visibilityLabel, fmtRange, fmtRangeLabeled, avatarStack, joinCta, fmtPanel, truncateName, statusTagClass } = require('../miniprogram/utils/campaign.js');

test('CU1 状态/可见性标签', () => {
  assert.equal(statusLabel('active'), '进行中');
  assert.equal(statusLabel('ended'), '已结束');
  assert.equal(statusLabel('dissolved'), '已解散');
  assert.equal(visibilityLabel('private'), '隐私');
});

test('CU2 活动时间范围按东八区显示，两端都带完整年月日', () => {
  // startAt = 东八区 2026-10-01 00:00
  const start = Date.UTC(2026, 8, 30, 16, 0, 0);
  // endAt = 东八区 2026-10-08 00:00（= 结束日 10-07 的 24:00，左闭右开）；展示要减 1ms 回到 10-07
  const end = Date.UTC(2026, 9, 7, 16, 0, 0);
  assert.equal(fmtRange(start, end), '2026/10/01 ~ 2026/10/07');
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
  // 边界：59m30s 应进位到 1h0m，不能显示 60min
  assert.deepEqual(fmtPanel({ count: 1, distance: 1000, duration: 3570 }), {
    countText: '1',
    streakText: '0',
    distanceText: '1.00',
    durationText: '1h0m',
  });
  // 边界：23h59m30s 应进位到 24h0m，不能显示 23h60m
  assert.deepEqual(fmtPanel({ count: 1, distance: 10000, duration: 86370 }), {
    countText: '1',
    streakText: '0',
    distanceText: '10.00',
    durationText: '24h0m',
  });
});

test('CU7 已退出且可再参加 → 「重新加入」/「重新申请」', () => {
  assert.deepEqual(joinCta({ myState: 'left', canJoin: true, status: 'active', visibility: 'public' }), { text: '重新加入', disabled: false });
  assert.deepEqual(joinCta({ myState: 'left', canJoin: true, status: 'active', visibility: 'private' }), { text: '重新申请', disabled: false });
});

test('CU8 已退出但不可再参加（人数已满）→ 仍落「人数已满」，不放行', () => {
  assert.deepEqual(joinCta({ myState: 'left', canJoin: false, status: 'active', visibility: 'public' }), { text: '人数已满', disabled: true });
});

test('CU9 带标签的时间行：开始 / 结束两端都带完整年月日', () => {
  // 东八区 2026-10-01 00:00 ~ 结束日 10-07（endAt = 10-08 00:00，左闭右开）
  assert.equal(
    fmtRangeLabeled(Date.UTC(2026, 8, 30, 16, 0, 0), Date.UTC(2026, 9, 7, 16, 0, 0)),
    '开始 2026/10/01 · 结束 2026/10/07',
  );
  // 跨年也照常两端带年份（不再是特例）
  assert.equal(
    fmtRangeLabeled(Date.UTC(2026, 11, 27, 16, 0, 0), Date.UTC(2027, 0, 3, 16, 0, 0)),
    '开始 2026/12/28 · 结束 2027/01/03',
  );
});

test('CU10 头像堆叠：签名 url 优先，回退预设图，都没有则空串（端上画占位圆）', () => {
  assert.deepEqual(
    avatarStack([
      { avatarUrl: 'https://x/a.png?sig=1', avatarPreset: 'default-1' },
      { avatarUrl: '', avatarPreset: 'default-2' },
      { avatarUrl: '', avatarPreset: '' },
    ]),
    [
      { key: 0, src: 'https://x/a.png?sig=1' },
      { key: 1, src: '/assets/avatars/default-2.png' },
      { key: 2, src: '' },
    ],
  );
  assert.deepEqual(avatarStack(), []);
  assert.deepEqual(avatarStack([]), []);
});

test('CU11 昵称截断：最多 10 个字，超出截断补「...」；emoji 按码点切不劈开代理对', () => {
  assert.equal(truncateName('阿迹', 10), '阿迹', '短昵称原样返回');
  const ten = '字'.repeat(10);
  assert.equal(truncateName(ten, 10), ten, '恰好 10 个字不截断、也不补省略号');
  assert.equal(truncateName('字'.repeat(11), 10), ten + '...', '超出 → 截到 10 个字再补「...」');
  assert.equal(
    truncateName('😀'.repeat(11), 10),
    '😀'.repeat(10) + '...',
    '必须按码点切：按 UTF-16 码元切会把最后一个 emoji 劈成半个字符（渲染成乱码方块）',
  );
  assert.equal(truncateName(''), '', '空串照旧');
  assert.equal(truncateName(undefined), '', '缺字段不炸');
});

test('CU12 状态→标签修饰类：基类就是中性灰，只有要跳出灰色的状态才给修饰类', () => {
  assert.equal(statusTagClass('active'), 'campaign-tag--active');
  assert.equal(statusTagClass('dissolved'), 'campaign-tag--dissolved');
  assert.equal(statusTagClass('ended'), '', '已结束用基类的中性灰，不需要修饰类');
  // 后端将来加新状态时落回基类，不会出现一条没样式的裸标签（与 statusLabel 原样透传同一取向）
  assert.equal(statusTagClass('archived'), '');
  assert.equal(statusTagClass(undefined), '');
});

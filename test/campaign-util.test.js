/**
 * 一起运动活动（campaign）纯函数单测（miniprogram/utils/campaign.js）。
 * 状态 / 可见性标签只住这个模块（R22）：首页区块、列表页、创建/详情页都从这里取文案，别在页面里再抄一份。
 * 运行：npm test；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { statusLabel, visibilityLabel, fmtRange, fmtRangeLabeled, avatarStack, joinCta, fmtPanel, truncateName, statusTagClass, initialOf } = require('../miniprogram/utils/campaign.js');

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
    durationText: '10分钟',
  });
  // 详情 myPanel 带连续天数时正常展示
  assert.deepEqual(fmtPanel({ count: 1, streak: 5, distance: 5000, duration: 3720 }), {
    countText: '1',
    streakText: '5',
    distanceText: '5.00',
    durationText: '1小时2分钟',
  });
  // 全空（新活动/无数据）：零值成串，不产生 undefined
  assert.deepEqual(fmtPanel({}), {
    countText: '0',
    streakText: '0',
    distanceText: '0.00',
    durationText: '0分钟',
  });
  // 边界：59m30s 应进位到整 1 小时，不能显示 60分钟
  assert.deepEqual(fmtPanel({ count: 1, distance: 1000, duration: 3570 }), {
    countText: '1',
    streakText: '0',
    distanceText: '1.00',
    durationText: '1小时',
  });
  // 边界：23h59m30s 应进位到 24 小时，不能显示 23小时60分钟
  assert.deepEqual(fmtPanel({ count: 1, distance: 10000, duration: 86370 }), {
    countText: '1',
    streakText: '0',
    distanceText: '10.00',
    durationText: '24小时',
  });
  // 满时带分钟：11h18m 口径
  assert.equal(fmtPanel({ duration: 40680 }).durationText, '11小时18分钟');
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

test('CU10 头像堆叠：签名 url 优先 → 预设图 → 都没有时用昵称首字占位（首字按码点取）', () => {
  assert.deepEqual(
    avatarStack([
      { avatarUrl: 'https://x/a.png?sig=1', avatarPreset: 'default-1', nickname: '阿迹' },
      { avatarUrl: '', avatarPreset: 'default-2', nickname: '周末爬山小队长' },
      { avatarUrl: '', avatarPreset: '', nickname: '小美' },
      { avatarUrl: '', avatarPreset: '', nickname: '🏃跑者' },
      { avatarUrl: '', avatarPreset: '', nickname: '' },
    ]),
    [
      { key: 0, src: 'https://x/a.png?sig=1', text: '阿' },
      { key: 1, src: '/assets/avatars/default-2.png', text: '周' },
      { key: 2, src: '', text: '小' },
      { key: 3, src: '', text: '🏃' }, // 按码点取：name[0] 会切出半个代理对，渲染成乱码方块
      { key: 4, src: '', text: '微' }, // 连昵称都没有 → 回退「微信用户」首字
    ],
  );
  assert.deepEqual(avatarStack(), []);
  assert.deepEqual(avatarStack([]), []);
  // 两张卡（首页轮播 / 活动列表）都得真的渲染这枚占位圆，光有数据不算修好
  const fs = require('fs');
  const path = require('path');
  [
    '../miniprogram/pages/campaign-list/campaign-list.wxml',
    '../miniprogram/pages/index/index.wxml',
  ].forEach((rel) => {
    const w = fs.readFileSync(path.join(__dirname, rel), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    assert.match(w, /class="member-av member-av-char"/, `${rel} 用占位圆渲染`);
    assert.match(w, /member-av-char"[^>]*>\{\{\w+\.text\}\}/, `${rel} 把首字画进占位圆`);
  });
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

test('CU13 未开始（upcoming）：标签文案「未开始」，且给专属修饰类不与「已结束」共用灰底', () => {
  assert.equal(statusLabel('upcoming'), '未开始', '后端新增档位，端上必须有名可显');
  assert.equal(
    statusTagClass('upcoming'),
    'campaign-tag--upcoming',
    '「未开始」与「已结束」语义相反（一个在前一个在后），共用灰底会让人误读成同一档',
  );
});

test('CU14 未开始的活动仍可加入：报名早于开赛是常态，按钮不该置灰', () => {
  assert.deepEqual(
    joinCta({ myState: 'none', canJoin: true, status: 'upcoming', visibility: 'public' }),
    { text: '加入活动', disabled: false },
  );
  assert.deepEqual(
    joinCta({ myState: 'none', canJoin: true, status: 'upcoming', visibility: 'private' }),
    { text: '申请加入', disabled: false },
  );
  // 但人数已满时仍要挡住，不因「未开始」放行
  assert.deepEqual(
    joinCta({ myState: 'none', canJoin: false, status: 'upcoming', visibility: 'public' }),
    { text: '人数已满', disabled: true },
  );
});

test('CU15 占位首字按码点取：emoji 开头的昵称不能切出半个代理对', () => {
  assert.equal(initialOf('阿迹', '迹'), '阿');
  assert.equal(initialOf('🏃跑者', '迹'), '🏃', '码点取才是一个完整 emoji（name[0] 会切出代理对的前一半）');
  assert.equal(initialOf('', '迹'), '迹', '空昵称走缺省字');
  assert.equal(initialOf(null, '微信用户'), '微');
  assert.equal(initialOf('🏃', '迹'), '🏃', '整个昵称就是一个 emoji 时也要完整');
});

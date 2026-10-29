/**
 * 积分主页（pages/points/points）与个人中心入口回归：
 * 1) 结构：app.json 注册路由、我的页有入口、积分页有签到/任务/补签卡/明细/规则；
 * 2) 登录闸门走触点级：游客进页不弹登录、不发请求，只有点「登录后查看积分」才 ensureLogin + 拉汇总；
 * 3) 汇总只读 /points/summary，映射余额/cells 七格/任务行/道具卡；
 * 4) 签到与任务领取走 POST；补签走 POST /points/signin/makeup {dateKey}（卡由服务端挑，前端不传卡 id）；
 *    激励视频只有完播（isEnded===true）才领分，提前关闭/广告失败都不发分；
 * 5) 积分明细页（PP12–PP16）：触点到 /points/records 才发请求、分页 20 条、+N/-N 与余额、失败重试；
 * 6) 积分规则页（PP12/PP17）：静态 Q&A 覆盖连续签到/次日失效/有效期/每日上限/补签卡；
 * 7) 补签入口收口（PP29/PP30/PP35/PP37/PP38）：入口＝积分页七格里的「补」字（无独立胶囊行），
 *    商品页「去补签」以 summary 的 cells 为准（有 makeup 格才出现），
 *    兑换记录页去掉行内补签入口，已用的卡仍按 MM.DD 显示补了哪天。
 * 运行：node --test test/points-pages.test.js；桩：wx / Page / getApp 就地 stub，
 * services/api、utils/login-gate、utils/rewarded-ad 用 require.cache 注入假实现（isAdRewardEligible 用真实实现）。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const { bjDate, bjDateTime } = require('../miniprogram/utils/bj-date');

/* ------------------------------- 结构断言 ------------------------------- */

test('PP1 app.json 注册积分页面，我的页有入口', () => {
  const app = JSON.parse(read('miniprogram/app.json'));
  assert.ok(app.pages.includes('pages/points/points'));
  assert.ok(read('miniprogram/pages/my/my.wxml').includes('我的积分'));
  assert.ok(read('miniprogram/pages/my/my.js').includes('/pages/points/points'));
});

test('PP2 积分页：签到/任务/兑换入口存在，有效期由接口 validDays 渲染', () => {
  const wxml = read('miniprogram/pages/points/points.wxml');
  assert.ok(wxml.includes('今日签到') || wxml.includes('明日签到'));
  assert.ok(wxml.includes('补签卡'));
  assert.ok(wxml.includes('积分规则'));
  assert.ok(wxml.includes('积分明细'));
  assert.ok(wxml.includes('{{item.metaText}}'), '兑换卡有效期（含库存）由派生 metaText 渲染，来自接口 validDays/stockLeft');
  assert.ok(!wxml.includes('30 天有效'), '不能在 WXML 写死 30 天');
});

/* --------------------------------- 环境桩 --------------------------------- */

const apiCalls = [];
let summaryRespond = null;
let postRespond = null;

// cells 用 PV7 那组七格（makeup 在 10-19 与 10-24）；canMakeUp/makeupDate/makeupCardId 已随后端删除（spec §5.1）
const summaryFixture = () => ({
  balance: 42,
  signin: {
    todaySigned: false, streakDay: 2, todayReward: 1, nextReward: 3, cards: 2,
    cells: [
      { dateKey: '2026-10-19', state: 'makeup', streakDay: 1, reward: 1, todayRewardAfter: 1 },
      { dateKey: '2026-10-20', state: 'signed', streakDay: 1, reward: 1 },
      { dateKey: '2026-10-21', state: 'signed', streakDay: 2, reward: 2 },
      { dateKey: '2026-10-22', state: 'missed', streakDay: 0, reward: 0 },
      { dateKey: '2026-10-23', state: 'signed', streakDay: 3, reward: 3 },
      { dateKey: '2026-10-24', state: 'makeup', streakDay: 4, reward: 4, todayRewardAfter: 6 },
      { dateKey: '2026-10-25', state: 'today', streakDay: 1, reward: 1 },
    ],
  },
  tasks: [
    // 故意把已领取的放最前：接口原序如此，页面要把它沉到末尾（未完成在前）
    { key: 'daily_activity', title: '每日运动', points: 5, status: 'claimed', actionText: '已领取' },
    { key: 'newbie_profile', title: '完善资料', points: 10, status: 'claimable', actionText: '领取' },
    { key: 'daily_video', title: '每日看视频', points: 5, status: 'claimable', actionText: '去观看', times: 3, timesLeft: 2 },
  ],
  items: [{ key: 'makeup_card', name: '补签卡', subtitle: '恢复连续打卡记录', price: 30, validDays: 30, todayLeft: 2 }],
});

const fakeApi = {
  get(p, params) {
    apiCalls.push({ method: 'GET', url: p, params });
    return summaryRespond(p, params);
  },
  post(p, data) {
    apiCalls.push({ method: 'POST', url: p, data });
    return postRespond(p, data);
  },
};

const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };

let loginCalls = 0;
let loginAnswer = true;
const loginGatePath = require.resolve('../miniprogram/utils/login-gate.js');
require.cache[loginGatePath] = {
  id: loginGatePath,
  filename: loginGatePath,
  loaded: true,
  exports: {
    ensureLogin: () => {
      loginCalls += 1;
      return Promise.resolve(loginAnswer);
    },
    // 页面闸门改成异步等会话后，桩件按「当前 appLoggedIn」即时回答，语义与真实实现一致
    waitSession: () => Promise.resolve(!!appLoggedIn),
  },
  children: [],
  paths: [],
};

/** 假激励视频实例：记录 onClose 监听，show 行为可按用例替换 */
function makeAd() {
  const ad = {
    listeners: [],
    onClose(fn) {
      ad.listeners.push(fn);
    },
    offClose(fn) {
      ad.listeners = ad.listeners.filter((f) => f !== fn);
    },
    show() {
      return ad.showImpl ? ad.showImpl() : Promise.resolve();
    },
    load() {
      return Promise.resolve();
    },
  };
  return ad;
}

let currentAd = null;
let adCreates = 0;
const adPath = require.resolve('../miniprogram/utils/rewarded-ad.js');
const { isAdRewardEligible } = require('../miniprogram/utils/rewarded-ad.js'); // 完播判定用真实实现
require.cache[adPath] = {
  id: adPath,
  filename: adPath,
  loaded: true,
  exports: {
    isAdRewardEligible,
    createRewardedAd: () => {
      adCreates += 1;
      return currentAd;
    },
  },
  children: [],
  paths: [],
};

const toasts = [];
const navs = [];
const modals = [];
let modalAnswer = true;
/** 剪贴板桩：物流单号复制走 setClipboardData，用例要能读到写进去的内容 */
let clipboard = null;
/** 下拉刷新收起次数：onPullDownRefresh 必须真的调 stopPullDownRefresh，否则动画一直转 */
let pullStops = 0;
/** 本地存储桩：详情页用它记住上次填的收货地址（真机上这两个 API 一定存在，所以补在桩里，不给页面加防御分支） */
const storage = new Map();
global.wx = {
  showToast: (o) => toasts.push(o && o.title),
  hideToast: () => {},
  stopPullDownRefresh: () => {
    pullStops += 1;
  },
  setClipboardData: (o) => {
    clipboard = o && o.data;
    if (o && typeof o.success === 'function') o.success();
  },
  navigateTo: (o) => navs.push(o && o.url),
  setNavigationBarTitle: () => {},
  getStorageSync: (k) => (storage.has(k) ? storage.get(k) : ''),
  setStorageSync: (k, v) => {
    storage.set(k, v);
  },
  showModal: (o) => {
    modals.push(o);
    if (o && typeof o.success === 'function') o.success({ confirm: modalAnswer });
  },
};

let appLoggedIn = true;
global.getApp = () => ({ globalData: { loggedIn: appLoggedIn } });

let pageDef = null;
global.Page = (def) => {
  pageDef = def;
};

require('../miniprogram/pages/points/points.js');
assert.ok(pageDef, 'points.js 应通过 Page() 交出页面对象');

/* --------------------------------- 页面装配 --------------------------------- */

const tick = () => new Promise((r) => setImmediate(r));
const calls = () => apiCalls.map((c) => `${c.method} ${c.url}`);

function reset({ loggedIn = true } = {}) {
  apiCalls.length = 0;
  toasts.length = 0;
  navs.length = 0;
  modals.length = 0;
  modalAnswer = true;
  clipboard = null;
  pullStops = 0;
  loginCalls = 0;
  loginAnswer = true;
  appLoggedIn = loggedIn;
  summaryRespond = () => Promise.resolve(summaryFixture());
  postRespond = () => Promise.resolve({});
  currentAd = makeAd();
  adCreates = 0;
}

/** 起一个页面实例（onLoad 里的 fetch 不等返回值，调用方用 tick() 等它落地） */
function boot() {
  const p = Object.assign({}, pageDef);
  p.data = JSON.parse(JSON.stringify(pageDef.data));
  p.setData = (patch = {}) => Object.assign(p.data, patch);
  p.onLoad();
  return p;
}

/* ---------------------------------- 用例 ---------------------------------- */

test('PP3 游客进页：不弹登录、不发请求，展示登录引导', async () => {
  reset({ loggedIn: false });
  const p = boot();
  await tick();
  assert.equal(loginCalls, 0);
  assert.deepEqual(calls(), []);
  assert.equal(p.data.loggedIn, false);
  assert.equal(p.data.loading, false);
  assert.ok(read('miniprogram/pages/points/points.wxml').includes('登录后查看积分'));
});

test('PP4 登录用户进页：只读一次汇总并映射余额/cells 七格/任务/道具卡', async () => {
  reset();
  const p = boot();
  await tick();
  assert.deepEqual(calls(), ['GET /points/summary']);
  assert.equal(p.data.loggedIn, true);
  assert.equal(p.data.loading, false);
  assert.equal(p.data.balance, 42);
  assert.equal(p.data.cards, 2);
  assert.equal(p.data.signin.streakDay, 2);
  assert.equal(p.data.strip.length, 7);
  assert.deepEqual(
    p.data.strip.map((s) => s.dateKey),
    ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'],
  );
  assert.deepEqual(
    p.data.strip.map((s) => s.state),
    ['makeup', 'signed', 'signed', 'missed', 'signed', 'makeup', 'today'],
    '格子状态一律照抄服务端 cells，页面不自推位置/断口',
  );
  assert.deepEqual(p.data.strip.map((s) => s.dot), ['补', '+1', '+2', '未', '+3', '补', '+1']);
  assert.deepEqual(p.data.strip.map((s) => s.reward), [1, 1, 2, 0, 3, 4, 1], '分值原样带出 cells 的名义分');
  assert.ok(
    p.data.strip.every((s) => /^(今天|明天|\d{2}\.\d{2})$/.test(s.sub)),
    'sub 只能是「今天/明天/MM.DD」三种（由纯函数按 dateKey 比对）',
  );
  assert.deepEqual(
    p.data.strip.filter((s) => s.state === 'makeup').map((s) => s.dateKey),
    ['2026-10-19', '2026-10-24'],
    '补签入口＝七格里的 makeup 格（没有单独的胶囊行）',
  );
  assert.equal(p.data.hasMakeup, true, '有可补格才显示补签说明行');
  assert.equal(p.data.strip[0].todayRewardAfter, 1, '弹窗要用的「补完今天可拿几分」从 cells 原样带出');
  // 新手/每日分卡展示：各自组内「未完成在前」，新手卡完成后整卡隐藏（由 onceTasks.length 驱动）
  assert.deepEqual(
    p.data.taskGroups.onceTasks.map((t) => [t.key, t.actionText, t.disabled]),
    [['newbie_profile', '领取', false]],
  );
  assert.deepEqual(
    p.data.taskGroups.dailyTasks.map((t) => [t.key, t.actionText, t.disabled]),
    [['daily_video', '去观看', false], ['daily_activity', '已领取', true]],
  );
  assert.equal(p.data.items.length, 1);
  assert.deepEqual(p.data.items[0], {
    key: 'makeup_card', name: '补签卡', subtitle: '恢复连续打卡记录', price: 30, priceText: '30', validDays: 30,
    validText: '30 天有效', stockText: '', todayText: '今日剩余 2 张', metaText: '30 天有效', glyph: '补', imageUrl: '',
  });
});

test('PP5 游客点登录引导：取消不请求，登录成功才拉汇总', async () => {
  reset({ loggedIn: false });
  const p = boot();
  await tick();
  assert.deepEqual(calls(), []);

  loginAnswer = false;
  await p.onLoginTap();
  await tick();
  assert.equal(loginCalls, 1);
  assert.deepEqual(calls(), []);

  loginAnswer = true;
  appLoggedIn = true;
  await p.onLoginTap();
  await tick();
  assert.equal(loginCalls, 2);
  assert.deepEqual(calls(), ['GET /points/summary']);
  assert.equal(p.data.loggedIn, true);
});

test('PP5b 冷启动竞态：首屏停在游客引导，回到本页时会话已恢复就自动补拉', async () => {
  reset({ loggedIn: false });
  const p = boot();
  await tick();
  assert.equal(p.data.loggedIn, false, 'onLoad 时会话还没恢复完，按游客渲染');
  assert.deepEqual(calls(), [], '游客态一个请求都不发');

  appLoggedIn = true; // onLaunch 的静默登录随后才回来
  p.onShow();
  await tick();
  assert.deepEqual(calls(), [], 'onLoad 后紧跟的首次 onShow 不重复请求');

  p.onShow(); // 用户从别的页面回到本页
  await tick();
  assert.deepEqual(calls(), ['GET /points/summary']);
  assert.equal(p.data.loggedIn, true, '回到本页要自己补拉，不能继续要用户点引导');
});

test('PP5c 道具区是卡片列表：一行两个竖排卡，没道具图时图位回落名称首字', () => {
  const wxml = read('miniprogram/pages/points/points.wxml');
  assert.ok(/wx:for="{{items}}"/.test(wxml), '道具区要按接口下发的商品表循环，不能写死一张');
  assert.ok(wxml.includes('class="item-grid"') && wxml.includes('class="item-card"'), '两列网格 + 每个道具一张卡');
  assert.ok(wxml.includes('{{item.glyph}}'), '卡上图位用派生好的首字，不在 wxml 里拼字符串');
  assert.ok(wxml.includes('持有{{cards}}张'), '持卡数要在卡上带出来，兑换前就该知道自己有几张');
  assert.ok(wxml.includes('goExchangeRecords'), '标题右侧要有兑换记录入口');
});

test('PP6 签到：POST /points/sign-in 后刷新汇总', async () => {
  reset();
  const p = boot();
  await tick();
  apiCalls.length = 0;
  await p.onSignIn();
  await tick();
  assert.deepEqual(calls(), ['POST /points/sign-in', 'GET /points/summary']);
  assert.ok(toasts.includes('签到成功'));
});

test('PP7 任务：不可领的行不请求，可领的行 POST 领取接口', async () => {
  reset();
  const p = boot();
  await tick();

  apiCalls.length = 0;
  await p.onClaim({ currentTarget: { dataset: { key: 'daily_activity' } } });
  await tick();
  assert.deepEqual(calls(), [], '已领取任务点不动，也不能发请求');

  await p.onClaim({ currentTarget: { dataset: { key: 'newbie_profile' } } });
  await tick();
  assert.deepEqual(calls(), ['POST /points/tasks/newbie_profile/claim', 'GET /points/summary']);
  assert.ok(toasts.includes('领取成功'));
});

test('PP8 视频任务：广告实例只建一次，完播才领分，回调用完就解绑', async () => {
  reset();
  postRespond = () => Promise.resolve({ credited: 7 });
  const p = boot();
  await tick();
  apiCalls.length = 0;
  const claim = () => p.onClaim({ currentTarget: { dataset: { key: 'daily_video' } } });

  await claim();
  await tick();
  assert.equal(adCreates, 1);
  assert.equal(currentAd.listeners.length, 1);
  assert.equal(p.data.videoBusy, true);
  assert.deepEqual(calls(), [], '广告还没关，不能发领取请求');

  currentAd.listeners[0]({ isEnded: true });
  await tick();
  assert.deepEqual(calls(), ['POST /points/tasks/daily_video/claim', 'GET /points/summary']);
  assert.ok(toasts.includes('积分 +7'), '奖励文案用 claim 返回的 credited，不写死 +5');
  assert.ok(!read('miniprogram/pages/points/points.js').includes("'积分 +5'"), 'JS 里不能再硬编码视频分值');
  assert.equal(p.data.videoBusy, false);
  assert.equal(currentAd.listeners.length, 0, 'onClose 用完必须解绑');

  // 第二次观看复用同一个广告实例；提前关闭不发分
  apiCalls.length = 0;
  await claim();
  await tick();
  assert.equal(adCreates, 1, '广告实例应缓存复用，不能每次重建');
  currentAd.listeners[0]({ isEnded: false });
  await tick();
  assert.deepEqual(calls(), []);
  assert.equal(p.data.videoBusy, false);
});

test('PP9 视频任务：提前关闭与广告加载失败都不发分，并复位 busy', async () => {
  reset();
  const p = boot();
  await tick();
  apiCalls.length = 0;
  await p.onClaim({ currentTarget: { dataset: { key: 'daily_video' } } });
  await tick();
  currentAd.listeners[0]({});
  await tick();
  assert.deepEqual(calls(), []);
  assert.ok(toasts.some((t) => t.includes('未看完')));
  assert.equal(p.data.videoBusy, false);

  // 新页 + 广告拉取失败：show/load/show 全失败 → 提示并复位
  const q = boot();
  await tick();
  apiCalls.length = 0;
  currentAd = makeAd();
  currentAd.showImpl = () => Promise.reject(new Error('no fill'));
  await q.onClaim({ currentTarget: { dataset: { key: 'daily_video' } } });
  await tick();
  assert.deepEqual(calls(), []);
  assert.ok(toasts.some((t) => t.includes('广告加载失败')));
  assert.equal(q.data.videoBusy, false);
});

test('PP10 入口跳转：明细/规则/补签卡兑换页，补签不再用 makeup=1 跳商品页', async () => {
  reset();
  const p = boot();
  await tick();
  p.goRecords();
  p.goRules();
  p.goItem();
  assert.deepEqual(navs, [
    '/pages/points-records/points-records',
    '/pages/points-rules/points-rules',
    '/pages/points-item/points-item',
  ]);

  // Task 14：点哪张道具卡就把 key 带进详情页；无参调用（补签无卡跳兑换）仍是老链接
  navs.length = 0;
  p.goItem({ currentTarget: { dataset: { key: 'ad_free_7d' } } });
  p.goItem({ currentTarget: { dataset: {} } });
  assert.deepEqual(navs, [
    '/pages/points-item/points-item?key=ad_free_7d',
    '/pages/points-item/points-item',
  ], 'goItem 从 data-key 取 key；没有 key 时不拼空参数');
  assert.ok(
    read('miniprogram/pages/points/points.wxml').includes('data-key="{{item.key}}"'),
    '道具卡要把 key 回传给 goItem',
  );

  const js = read('miniprogram/pages/points/points.js');
  assert.ok(js.includes('/points/signin/makeup'), '补签走服务端按日接口 POST /points/signin/makeup');
  assert.ok(!js.includes('/points/cards/'), '旧「按卡 id 消耗」端点已删除，前端不再挑卡');
  assert.ok(!js.includes('makeup=1'), 'makeup=1 的死链要删掉');
});

test('PP11 汇总失败：failed 置位但页面不崩', async () => {
  reset();
  summaryRespond = () => Promise.reject(new Error('boom'));
  const p = boot();
  await tick();
  assert.equal(p.data.failed, true);
  assert.equal(p.data.loading, false);
});

test('PP29 七格「补」字补签：确认弹窗带 MM.DD 日期与补完分值 → POST /points/signin/makeup {dateKey} → 刷新', async () => {
  reset();
  const p = boot();
  await tick();
  assert.deepEqual(
    p.data.strip.filter((s) => s.state === 'makeup').map((s) => s.dateKey),
    ['2026-10-19', '2026-10-24'],
    '19 与 24 两格是补签入口',
  );
  postRespond = () => Promise.resolve({ credited: 1, toppedUp: 4 });
  const tap = { currentTarget: { dataset: { dateKey: '2026-10-19' } } };
  p.onMakeup(tap);
  p.onMakeup(tap); // makeupBusy 闸门：第一发还在飞时连点不能再发请求
  assert.equal(modals.length, 2, '两次点击都进确认弹窗，第二次在闸门处被挡下');
  assert.ok(modals[0].content.includes('10.19'), '弹窗日期与七格同为 MM.DD，不打 ISO 日期');
  assert.ok(modals[0].content.includes('今天可拿'), '要提前告知补完的效果');
  await tick();
  assert.deepEqual(apiCalls.filter((c) => c.method === 'POST').map((c) => `${c.url} ${JSON.stringify(c.data)}`),
    ['/points/signin/makeup {"dateKey":"2026-10-19"}'], '一次链路只发一次请求，体里只有 dateKey、没有卡 id');
  assert.ok(toasts.some((t) => t.includes('补签成功 +1')));
  assert.ok(toasts.some((t) => t.includes('另补发 4 分')));
  assert.equal(apiCalls.filter((c) => c.url === '/points/summary').length, 2, '成功后要重拉拿最新格子');
  assert.equal(p.makeupBusy, false, '落地后闸门要复位');
});

test('PP30 取消确认不发请求；无卡时点「补」格跳兑换页而不是发请求', async () => {
  reset();
  const p = boot();
  await tick();
  modalAnswer = false;
  p.onMakeup({ currentTarget: { dataset: { dateKey: '2026-10-19' } } });
  await tick();
  assert.deepEqual(calls().filter((c) => c.startsWith('POST')), [], '取消不能发请求');
  modalAnswer = true;
  p.setData({ cards: 0 });
  p.onMakeup({ currentTarget: { dataset: { dateKey: '2026-10-19' } } });
  await tick();
  assert.deepEqual(calls().filter((c) => c.startsWith('POST')), []);
  assert.deepEqual(navs, ['/pages/points-item/points-item'], '无卡要落到兑换页');
  assert.equal(modals.length, 1, '无卡不弹确认，此前只有取消那一次');

  // 不是 makeup 格的日期点不动：入口与 cells 同源，防陈旧/伪造的 dataset（卡仍由服务端挑）
  p.onMakeup({ currentTarget: { dataset: { dateKey: '2026-10-22' } } });
  await tick();
  assert.equal(navs.length, 1, '不是 makeup 格的日期既不跳转也不发请求');
  assert.deepEqual(calls().filter((c) => c.startsWith('POST')), []);
});

test('PP31 服务端 400 原样提示并刷新最新状态', async () => {
  reset();
  const p = boot();
  await tick();
  postRespond = () => Promise.reject(Object.assign(new Error('断签超过 2 天或超出窗口，该日不能补签'), { statusCode: 400 }));
  p.onMakeup({ currentTarget: { dataset: { dateKey: '2026-10-19' } } });
  await tick();
  assert.ok(toasts.some((t) => t.includes('断签超过 2 天')));
  assert.equal(apiCalls.filter((c) => c.url === '/points/summary').length, 2, '失败后要重拉一次拿最新格子');
  assert.equal(p.makeupBusy, false);
});

test('PP32 积分页首屏加载中：显示加载态，不出现游客引导', async () => {
  reset();
  let release = null;
  summaryRespond = () => new Promise((resolve) => {
    release = () => resolve(summaryFixture());
  });
  const p = boot();
  assert.equal(p.data.loading, true);
  assert.equal(p.data.failed, false);

  const wxml = read('miniprogram/pages/points/points.wxml');
  assert.ok(wxml.includes('wx:if="{{loading && !loggedIn}}"'), '首屏无数据时才显示整页加载态');
  assert.ok(wxml.includes('加载中'), '加载态要有文案，不能空白');

  await tick(); // 闸门（等静默登录）放行后请求才发出
  release();
  await tick();
  assert.equal(p.data.loading, false);
  assert.equal(p.data.loggedIn, true);
  assert.equal(p.data.balance, 42);
});

test('PP33 登录用户汇总失败：显示重试块（不是游客引导），点重试恢复', async () => {
  reset();
  summaryRespond = () => Promise.reject(new Error('boom'));
  const p = boot();
  await tick();
  assert.equal(p.data.failed, true);
  assert.equal(p.data.loading, false);
  assert.deepEqual(calls(), ['GET /points/summary']);

  const wxml = read('miniprogram/pages/points/points.wxml');
  assert.ok(wxml.includes('wx:elif="{{failed}}"'), '失败态单独一支');
  assert.ok(wxml.includes('bindtap="onRetry"'), '重试块整块可点');
  assert.ok(wxml.includes('点击重试'));
  assert.ok(
    wxml.indexOf('wx:elif="{{failed}}"') < wxml.indexOf('wx:elif="{{loggedIn}}"'),
    '失败分支必须排在已登录内容之前',
  );

  // 游客引导必须挂在 wx:else（即 未加载/未失败/未登录 之后的兜底支）
  const guestIdx = wxml.indexOf('登录后查看积分');
  const guestTag = wxml.slice(wxml.lastIndexOf('<view', guestIdx), guestIdx);
  assert.ok(guestTag.includes('wx:else'), '游客引导只能是兜底支，失败态不能落到这里');
  assert.ok(!guestTag.includes('failed'), '失败态不能与游客引导同支');

  // 点重试重新拉汇总并恢复
  summaryRespond = () => Promise.resolve(summaryFixture());
  await p.onRetry();
  await tick();
  assert.equal(p.data.failed, false);
  assert.equal(p.data.loggedIn, true);
  assert.equal(p.data.balance, 42);
  assert.deepEqual(calls(), ['GET /points/summary', 'GET /points/summary']);
});

test('PP34 连签天数常驻卡头：旧的「已连续 N 天 · 每日 7 分」整行随改版撤掉', async () => {
  reset();
  summaryRespond = () => Promise.resolve(Object.assign({}, summaryFixture(), {
    signin: Object.assign({}, summaryFixture().signin, {
      todaySigned: true, streakDay: 9, todayReward: 7, nextReward: 7, cards: 0,
      cells: summaryFixture().signin.cells.map((c, i) => (
        c.state === 'today'
          ? { ...c, streakDay: 9, reward: 7 }
          : { ...c, state: 'signed', streakDay: 3 + i, reward: 7 }
      )),
    }),
    streakPercentile: 91,
  }));
  const p = boot();
  await tick();
  // 2026-10-28 改版：连签天数不再分「满 7 天才提示」，卡头常驻「连签 N 天」+ 百分位副题
  assert.equal(p.data.streakText, undefined, 'streakText 字段随 streak-note 那行一起撤走');
  assert.equal(p.data.streakSub, '超过 91% 用户');
  const wxml = read('miniprogram/pages/points/points.wxml');
  assert.ok(!wxml.includes('streakText') && !wxml.includes('streak-note'),
    '旧文案节点不得以另一个名字复活');
});

test('PP35 补签入口收口在七格：cells 里没有 makeup 格时不出现补签入口，也没有单独的胶囊行', async () => {
  reset();
  summaryRespond = () => Promise.resolve(Object.assign({}, summaryFixture(), {
    signin: Object.assign({}, summaryFixture().signin, {
      cells: summaryFixture().signin.cells.map((c) => (c.state === 'makeup' ? { ...c, state: 'missed' } : c)),
    }),
  }));
  const p = boot();
  await tick();
  assert.ok(!p.data.strip.some((s) => s.state === 'makeup'), '七格里也没有 makeup 格');
  assert.equal(p.data.hasMakeup, false, '没有可补格就不出现补签说明行');

  const wxml = read('miniprogram/pages/points/points.wxml');
  const js = read('miniprogram/pages/points/points.js');
  assert.ok(!wxml.includes('makeup-link'), '旧的单条补签链接要删掉');
  assert.ok(!js.includes('canMakeUp') && !js.includes('makeupCardId') && !js.includes('makeupDate'),
    '后端已删的 canMakeUp/makeupDate/makeupCardId 前端不能再读');
  assert.ok(!wxml.includes('chip-row') && !wxml.includes('makeup-chip'), '七格下方的补签胶囊行要删掉（入口就在格子里）');
  assert.ok(wxml.includes('data-date-key'), '七格回传 dateKey，服务端按日校验');
  assert.ok(wxml.includes('bindtap="onMakeup"'), '补签入口挂在七格上');
  assert.ok(wxml.includes('class="signin-cell {{item.state}}"'), '七格配色由 cells.state 驱动');
  assert.ok(wxml.includes('<view class="makeup-note" wx:if="{{hasMakeup}}">'), '说明行跟可补格同源，不留常驻噪声');
});

test('PP36 七格「今天」由东八区 dateKey 比对：页面把 bjDate(Date.now()) 作 todayKey 传给纯函数', async () => {
  reset();
  const today = bjDate(Date.now());
  // 动态锚定到真·今天：起点今天-6，前六格已签、第七格 today——只有页面传对 todayKey，第七格 sub 才是「今天」
  const cells = [1, 2, 3, 4, 5, 6].map((k) => ({
    dateKey: bjDate(Date.now() - (7 - k) * 86400000),
    state: 'signed', streakDay: k, reward: Math.min(k, 7),
  })).concat([{ dateKey: today, state: 'today', streakDay: 7, reward: 7 }]);
  summaryRespond = () => Promise.resolve(Object.assign({}, summaryFixture(), {
    signin: Object.assign({}, summaryFixture().signin, { cells, cards: 0 }),
  }));
  const p = boot();
  await tick();
  assert.equal(p.data.strip.length, 7);
  assert.equal(p.data.strip[6].sub, '今天', '传时间戳/本地日都会让「今天」比对失效');
  assert.equal(p.data.strip[6].dot, '+7');
  assert.ok(p.data.strip.slice(0, 6).every((s) => /^\d{2}\.\d{2}$/.test(s.sub)), '其余格按 MM.DD 格式化');
});

/* --------------------------- 明细页 / 规则页回归 --------------------------- */

/** 单独加载某个页面（页面模块在 require 时通过 Page() 交出定义）。
 *  require 一律字面量路径（安全门禁把变量 require 判成动态注入）；新增页面先在下表登记 */
const PAGE_LOADERS = {
  'miniprogram/pages/points-records/points-records.js': () =>
    require('../miniprogram/pages/points-records/points-records.js'),
  'miniprogram/pages/points-item/points-item.js': () =>
    require('../miniprogram/pages/points-item/points-item.js'),
  'miniprogram/pages/points-exchanges/points-exchanges.js': () =>
    require('../miniprogram/pages/points-exchanges/points-exchanges.js'),
  'miniprogram/pages/points-rules/points-rules.js': () =>
    require('../miniprogram/pages/points-rules/points-rules.js'),
};

function loadPage(relPath) {
  let def = null;
  const prev = global.Page;
  global.Page = (d) => {
    def = d;
  };
  const abs = require.resolve(path.join(root, relPath));
  delete require.cache[abs];
  const load = PAGE_LOADERS[relPath];
  assert.ok(load, `loadPage 未登记的页面：${relPath}`);
  load(); // 缓存已删，字面量 require 会重新执行页面模块
  global.Page = prev;
  assert.ok(def, `${relPath} 应通过 Page() 交出页面对象`);
  return def;
}

/** 用任意页面定义起实例（onLoad 里的 fetch 由调用方 tick() 等待） */
function bootWith(def) {
  const p = Object.assign({}, def);
  p.data = JSON.parse(JSON.stringify(def.data));
  p.setData = (patch = {}) => Object.assign(p.data, patch);
  p.onLoad();
  return p;
}

const recordItem = (over = {}) => Object.assign({
  id: 'r1',
  title: '每日签到',
  delta: 5,
  balanceAfter: 47,
  createdAt: 1790000000000,
}, over);

test('PP12 明细页使用 /points/records，规则页含签到/有效期/补签卡', () => {
  assert.ok(read('miniprogram/pages/points-records/points-records.js').includes('/points/records'));
  const rules = read('miniprogram/pages/points-rules/points-rules.wxml');
  assert.ok(rules.includes('连续签到'));
  assert.ok(rules.includes('次日'));
  assert.ok(rules.includes('补签卡'));
  assert.ok(rules.includes('100'));
});

test('PP13b 明细页带 type 进入：筛选参数透传 + 筛选标签展示', async () => {
  reset({ loggedIn: true });
  appLoggedIn = true;
  summaryRespond = () => Promise.resolve({ balance: 9, total: 1, items: [recordItem({ type: 'exchange' })] });
  const def = loadPage('miniprogram/pages/points-records/points-records.js');
  // 模拟「兑换记录」入口：onLoad({ type: 'exchange' })
  const p = Object.assign({}, def);
  p.data = JSON.parse(JSON.stringify(def.data));
  p.setData = (patch = {}) => Object.assign(p.data, patch);
  p.onLoad({ type: 'exchange' });
  await tick();
  assert.equal(p.data.typeFilter, 'exchange');
  const recCalls = calls().filter((c) => c.startsWith('GET /points/records'));
  assert.ok(recCalls.length >= 1);
  assert.deepEqual(apiCalls.find((c) => c.url === '/points/records').params.type, 'exchange');
  assert.ok(read('miniprogram/pages/points-records/points-records.wxml').includes('仅看兑换记录'));

  // 不带 type：不透传筛选
  apiCalls.length = 0;
  const q = Object.assign({}, def);
  q.data = JSON.parse(JSON.stringify(def.data));
  q.setData = (patch = {}) => Object.assign(q.data, patch);
  q.onLoad();
  await tick();
  assert.equal(q.data.typeFilter, '');
  const plain = apiCalls.find((c) => c.url === '/points/records');
  assert.ok(plain && !('type' in plain.params), '无筛选时不应带 type 参数');
});

test('PP13 app.json 注册积分明细与积分规则页', () => {
  const app = JSON.parse(read('miniprogram/app.json'));
  assert.ok(app.pages.includes('pages/points-records/points-records'));
  assert.ok(app.pages.includes('pages/points-rules/points-rules'));
});

test('PP14 明细页游客：不弹登录不发请求；点引导登录成功后才拉第一页', async () => {
  reset({ loggedIn: false });
  const def = loadPage('miniprogram/pages/points-records/points-records.js');
  const p = bootWith(def);
  await tick();
  assert.equal(loginCalls, 0);
  assert.deepEqual(calls(), []);
  assert.equal(p.data.loggedIn, false);
  assert.equal(p.data.loading, false);
  assert.ok(read('miniprogram/pages/points-records/points-records.wxml').includes('登录后查看积分明细'));

  loginAnswer = true;
  appLoggedIn = true;
  summaryRespond = () => Promise.resolve({ balance: 12, total: 1, items: [recordItem()] });
  await p.onLoginTap();
  await tick();
  assert.equal(loginCalls, 1);
  assert.deepEqual(calls(), ['GET /points/records']);
  assert.equal(p.data.loggedIn, true);
  assert.equal(p.data.balance, 12);
  assert.equal(p.data.items.length, 1);
});

test('PP15 明细页：+N/-N、余额与东八区日期（兼容毫秒与 ISO 时间串）', async () => {
  reset();
  const ts = 1790000000000;
  const iso = '2026-10-23T17:30:00.000Z';
  summaryRespond = () => Promise.resolve({
    balance: 47,
    total: 2,
    items: [
      recordItem({ id: 'a', delta: 5, balanceAfter: 47, createdAt: ts }),
      recordItem({ id: 'b', title: '兑换补签卡', delta: -200, balanceAfter: 42, createdAt: iso }),
    ],
  });
  const def = loadPage('miniprogram/pages/points-records/points-records.js');
  const p = bootWith(def);
  await tick();
  assert.deepEqual(
    apiCalls.map((c) => [c.method, c.url, c.params]),
    [['GET', '/points/records', { page: 1, pageSize: 20 }]],
  );
  assert.equal(p.data.items[0].deltaText, '+5');
  assert.equal(p.data.items[0].positive, true);
  assert.equal(p.data.items[0].balanceAfter, 47);
  assert.equal(p.data.items[0].dateText, bjDate(ts));
  assert.equal(p.data.items[1].deltaText, '-200');
  assert.equal(p.data.items[1].positive, false);
  assert.equal(p.data.items[1].dateText, bjDate(Date.parse(iso)));
  assert.equal(p.data.hasMore, false);
});

test('PP16 明细页：满 20 条上拉加载下一页，末页停止；失败可重试第一页', async () => {
  reset();
  const makeItems = (n, prefix) =>
    Array.from({ length: n }, (_, i) => recordItem({ id: `${prefix}${i}`, createdAt: 1790000000000 + i }));
  summaryRespond = (p, params) => Promise.resolve({
    balance: 100,
    total: 25,
    items: params.page === 1 ? makeItems(20, 'a') : makeItems(5, 'b'),
  });
  const def = loadPage('miniprogram/pages/points-records/points-records.js');
  const p = bootWith(def);
  await tick();
  assert.equal(p.data.items.length, 20);
  assert.equal(p.data.hasMore, true);

  await p.onReachBottom();
  await tick();
  assert.deepEqual(apiCalls.map((c) => c.params.page), [1, 2]);
  assert.equal(p.data.items.length, 25);
  assert.equal(p.data.hasMore, false);

  await p.onReachBottom();
  await tick();
  assert.equal(apiCalls.length, 2, '没有更多时不再请求');

  reset();
  let fail = true;
  summaryRespond = () => (fail
    ? Promise.reject(new Error('boom'))
    : Promise.resolve({ balance: 3, total: 1, items: [recordItem()] }));
  const q = bootWith(def);
  await tick();
  assert.equal(q.data.failed, true);
  assert.equal(q.data.loading, false);

  fail = false;
  await q.onRetry();
  await tick();
  assert.equal(q.data.failed, false);
  assert.equal(q.data.items.length, 1);
  assert.equal(apiCalls[apiCalls.length - 1].params.page, 1);
});

test('PP17 规则页：答案钉在实际渲染的 Q&A 文本上，补签条目已是窗口口径、旧「只能补昨天」不复活', () => {
  const rules = read('miniprogram/pages/points-rules/points-rules.wxml');
  // 与 PP22 同一收紧思路：断言只作用在 `<text class="a">` 答案叶子文本上——
  // wxml 注释里塞「昨天」或「只能补签昨天」顶不掉正向钉、也躲不掉负向钉（正向钉必须真渲染）。
  const answers = [...rules.matchAll(/<text class="a">([\s\S]*?)<\/text>/g)].map((m) => m[1]).join(' ');
  ['连续签到', '第 7 天', '断签', '次日', '视频', '次年', '100', '30 天', '当前标价',
    '近 7 天窗口', '漏签日', '窗口内需有签到记录', '今天已签到也能补'].forEach((s) => {
    assert.ok(answers.includes(s), `规则页答案缺少「${s}」`);
  });
  // 价格是后台可改的运营配置（2026-10-28 补签卡 200→49）：静态规则页写死数字必然说谎
  assert.ok(
    !/补签卡[^。]*?\d{2,}\s*积分/.test(answers),
    '规则页不得写死补签卡价格，只能指向商品卡下发的标价',
  );
  assert.ok(answers.includes('min(N, 7)'), '连续签到奖励应写明 min(N, 7)');
  assert.ok(!answers.includes('昨天'), '补签规则答案不得再出现「昨天」旧窗口口径——可补范围以近 7 天窗口为准（段长上限已放宽）');
  assert.ok(!rules.includes('只能补签昨天'), '静态旧文案「只能补签昨天」不得以任何节点复活');
});

test('PP18 明细页：首屏 loading 与翻页 loadingMore 分离，翻页中保留已渲染行', async () => {
  reset();
  const makeItems = (n, prefix) =>
    Array.from({ length: n }, (_, i) => recordItem({ id: `${prefix}${i}`, createdAt: 1790000000000 + i }));
  let resolveMore = null;
  summaryRespond = (p, params) => {
    if (params.page === 1) return Promise.resolve({ balance: 100, total: 25, items: makeItems(20, 'a') });
    return new Promise((resolve) => {
      resolveMore = () => resolve({ balance: 100, total: 25, items: makeItems(5, 'b') });
    });
  };
  const def = loadPage('miniprogram/pages/points-records/points-records.js');
  const p = bootWith(def);
  await tick();
  assert.equal(p.data.loading, false, '首屏落地后整页加载态结束');
  assert.equal(p.data.loadingMore, false);
  assert.equal(p.data.items.length, 20);

  const pending = p.onReachBottom();
  assert.equal(p.data.loadingMore, true, '翻页只进 loadingMore');
  assert.equal(p.data.loading, false, '翻页不能把整页打回「加载中」');
  assert.equal(p.data.items.length, 20, '翻页期间已渲染的 20 行不能被清掉');
  await tick(); // 闸门放行后第 2 页请求才发出
  assert.equal(p.onReachBottom(), undefined, '翻页在飞时不重复请求');
  assert.equal(apiCalls.length, 2);
  assert.ok(
    read('miniprogram/pages/points-records/points-records.wxml').includes('wx:if="{{loadingMore}}"'),
    '底栏要有内联「加载中…」',
  );

  resolveMore();
  await pending;
  assert.equal(p.data.loadingMore, false);
  assert.equal(p.data.items.length, 25);
  assert.equal(p.data.hasMore, false);
});

test('PP19 明细页：第 2 页失败保留已有 20 行与 hasMore，底栏重试仍翻第 2 页', async () => {
  reset();
  const makeItems = (n, prefix) =>
    Array.from({ length: n }, (_, i) => recordItem({ id: `${prefix}${i}`, createdAt: 1790000000000 + i }));
  let failMore = true;
  summaryRespond = (p, params) => {
    if (params.page === 1) return Promise.resolve({ balance: 100, total: 25, items: makeItems(20, 'a') });
    if (failMore) return Promise.reject(new Error('boom'));
    return Promise.resolve({ balance: 100, total: 25, items: makeItems(5, 'b') });
  };
  const def = loadPage('miniprogram/pages/points-records/points-records.js');
  const p = bootWith(def);
  await tick();

  await p.onReachBottom();
  await tick();
  assert.equal(p.data.items.length, 20, '翻页失败不能丢已有行');
  assert.equal(p.data.hasMore, true, '翻页失败后仍可重试下一页');
  assert.equal(p.data.page, 1, '失败的那页不能推进页码');
  assert.equal(p.data.loading, false);
  assert.equal(p.data.loadingMore, false);
  assert.equal(p.data.loadMoreFailed, true);
  assert.equal(p.data.failed, false, '翻页失败不能顶成整页失败态');

  failMore = false;
  await p.onMoreRetry();
  await tick();
  assert.deepEqual(apiCalls.map((c) => c.params.page), [1, 2, 2], '底栏重试要重拉失败的第 2 页');
  assert.equal(p.data.items.length, 25);
  assert.equal(p.data.hasMore, false);
  assert.equal(p.data.loadMoreFailed, false);

  const wxml = read('miniprogram/pages/points-records/points-records.wxml');
  assert.ok(wxml.includes('bindtap="onMoreRetry"'), '底栏要有翻页失败重试入口');
  assert.ok(wxml.includes('record-list'), '行要有包裹层，末行分隔线才去得掉');
});

test('PP20 积分两页向 ensureLogin 传积分文案（默认足迹文案保持不变）', () => {
  assert.ok(
    read('miniprogram/pages/points-records/points-records.js').includes("ensureLogin('登录后查看积分记录。')"),
    '明细页要传「登录后查看积分记录。」',
  );
  assert.ok(
    read('miniprogram/pages/points/points.js').includes("ensureLogin('登录后查看积分。')"),
    '积分主页要传「登录后查看积分。」',
  );
  assert.ok(
    read('miniprogram/utils/login-gate.js').includes("content || '登录后才能记录你的足迹。'"),
    '不传文案时仍用足迹默认口径',
  );
});

/* --------------------- 补签卡详情页 / 兑换记录页（T11） --------------------- */

const ITEM_JS = 'miniprogram/pages/points-item/points-item.js';
const ITEM_WXML = 'miniprogram/pages/points-item/points-item.wxml';
const REC_JS = 'miniprogram/pages/points-records/points-records.js';
const EX_JS = 'miniprogram/pages/points-exchanges/points-exchanges.js';
const EX_WXML = 'miniprogram/pages/points-exchanges/points-exchanges.wxml';
const EX_WXSS = 'miniprogram/pages/points-exchanges/points-exchanges.wxss';

const itemFixture = () => ({
  key: 'makeup_card',
  name: '补签卡',
  subtitle: '恢复连续打卡记录',
  price: 200,
  validDays: 30,
  // 与 dev 服务端 points-items.ts getItems() 下发的描述逐字一致（测试替身跟紧真实契约）
  description: '每张仅可使用一次；可补签近 7 天窗口内的漏签日，补一天用一张；兑换后 30 天内有效',
});

/** 商品页同时依赖 /points/items 与 /points/summary，按路径分流 */
function itemPageRespond({ balance = 200, cards = 0 } = {}) {
  return (p) => {
    if (p === '/points/items') return Promise.resolve([itemFixture()]);
    if (p === '/points/summary') return Promise.resolve({ balance, signin: { cards }, tasks: [] });
    return Promise.resolve({});
  };
}

const exchangeRow = (over = {}) => Object.assign({
  id: 'e1',
  itemKey: 'makeup_card',
  cost: 200,
  cardId: 'c1',
  status: 'unused',
  statusText: '未使用',
  usedForDate: '',
  expiresAt: Date.now() + 86400000,
  createdAt: Date.UTC(2026, 9, 22, 2, 30),
}, over);

test('PP21 app.json 注册补签卡详情与兑换记录页；两页接入正确接口', () => {
  const app = JSON.parse(read('miniprogram/app.json'));
  assert.ok(app.pages.includes('pages/points-item/points-item'));
  assert.ok(app.pages.includes('pages/points-exchanges/points-exchanges'));

  const item = read(ITEM_JS);
  // Task 14：兑换接口按商品自己的 key 拼，补签卡（makeup_card）只是它的一个实例
  assert.ok(item.includes('/points/items/${this.data.item.key}/exchange'), '兑换走 /points/items/{key}/exchange');
  assert.ok(item.includes('requestId'));
  assert.ok(read(EX_JS).includes('/points/exchanges'));
});

test('PP22 商品页：/points/items + /points/summary 映射价格/余额/卡数，兑换说明与兑换记录入口', async () => {
  reset();
  summaryRespond = itemPageRespond({ balance: 260, cards: 2 });
  const def = loadPage(ITEM_JS);
  const p = bootWith(def);
  await tick();
  assert.deepEqual(calls(), ['GET /points/items', 'GET /points/summary']);
  assert.equal(p.data.loggedIn, true);
  assert.equal(p.data.loading, false);
  assert.equal(p.data.failed, false);
  assert.equal(p.data.item.price, 200);
  assert.equal(p.data.item.validDays, 30);
  assert.equal(p.data.balance, 260);
  assert.equal(p.data.cards, 2);
  assert.equal(p.data.priceText, '200 积分兑换');

  const wxml = read(ITEM_WXML);
  assert.ok(wxml.includes('{{priceText}}'), '底部按钮文案由接口价格拼出「200 积分兑换」');
  // 兑换说明改成按服务端下发的 item.notes 循环（每件商品自己的一套），补签卡三条不再写死在 wxml
  assert.ok(
    /<view class="note" wx:for="\{\{item\.notes\}\}" wx:key="\*this">· \{\{item\}\}<\/view>/.test(wxml),
    '兑换说明按 item.notes 循环，说明文案归服务端',
  );
  assert.ok(!wxml.includes('每张补签卡仅可使用一次'), '补签卡专属说明由服务端 notes 下发，wxml 不再硬编码');
  assert.ok(!wxml.includes('不退积分'), '说明三条一并交给服务端，wxml 不留补签卡专属文本');
  // 说明行本身（含 wx:for 属性）不得再夹带写死的旧窗口口径；wxml 注释里提「昨天」不算
  const noteRows = [...wxml.matchAll(/<view class="note"[^>]*>([\s\S]*?)<\/view>/g)].map((m) => m[1]).join(' ');
  assert.ok(!noteRows.includes('昨天'), 'note 行不得再出现「只能补签昨天」旧窗口口径——可补范围以服务端下发 notes 为准');
  assert.ok(!wxml.includes('只能补签昨天'), '静态旧文案「只能补签昨天」不得以任何节点复活');
  assert.ok(wxml.includes('{{item.validDays}} 天'), '有效期天数由接口 validDays 拼出，不写死 30');
  assert.ok(!wxml.includes('30 天'), 'WXML 里不能再硬编码 30 天');
  assert.ok(wxml.includes('我的补签卡'), '已有未使用卡时展示「我的补签卡 N 张」');
  assert.ok(wxml.includes('wx:if="{{isMakeup && cards > 0}}"'), '这一栏是补签卡专属，非补签商品不出现');
  assert.ok(wxml.includes('兑换记录'));
  assert.ok(wxml.includes('bindtap="goExchanges"'));

  p.goExchanges();
  assert.deepEqual(navs, ['/pages/points-exchanges/points-exchanges']);
});

test('PP23 商品页兑换：POST 带一次性 requestId、busy 期间连点不重复提交、刷新落地后才清 busy', async () => {
  reset();
  let summaryFetches = 0;
  let resolveSummary = null;
  summaryRespond = (p) => {
    if (p === '/points/items') return Promise.resolve([itemFixture()]);
    summaryFetches += 1;
    if (summaryFetches === 1) return Promise.resolve({ balance: 200, signin: { cards: 0 }, tasks: [] });
    // 兑换成功后的那次刷新先挂起，用来验证 busy 不会被提前清掉
    return new Promise((r) => {
      resolveSummary = () => r({ balance: 200, signin: { cards: 1 }, tasks: [] });
    });
  };
  let resolvePost = null;
  postRespond = () => new Promise((r) => {
    resolvePost = r;
  });
  const def = loadPage(ITEM_JS);
  const p = bootWith(def);
  await tick();
  apiCalls.length = 0;

  const pending = p.onExchange();
  assert.equal(p.data.busy, true);
  await p.onExchange();
  assert.equal(apiCalls.length, 1, 'busy 中的连点不能再发请求');
  assert.equal(apiCalls[0].method, 'POST');
  assert.equal(apiCalls[0].url, '/points/items/makeup_card/exchange');
  const firstId = apiCalls[0].data.requestId;
  assert.match(firstId, /^\d+-[a-z0-9]+$/, 'requestId 形如 ${Date.now()}-${random}');

  resolvePost({ cardId: 'c1', balance: 0 });
  await tick();
  assert.equal(p.data.busy, true, '成功刷新还没落地，busy 不能提前清掉');
  assert.equal(typeof resolveSummary, 'function', 'POST 成功后应立即发起刷新');
  resolveSummary();
  await pending;
  assert.equal(p.data.busy, false);
  assert.deepEqual(calls(), [
    'POST /points/items/makeup_card/exchange',
    'GET /points/items',
    'GET /points/summary',
  ]);
  assert.ok(toasts.includes('兑换成功'));

  // 再次兑换必须换新的 requestId（服务端按 requestId 幂等，复用会变成「点了没反应」）
  apiCalls.length = 0;
  summaryRespond = itemPageRespond({ balance: 200 });
  postRespond = () => Promise.resolve({ cardId: 'c2', balance: 0 });
  await p.onExchange();
  await tick();
  const secondId = apiCalls.find((c) => c.method === 'POST').data.requestId;
  assert.notEqual(secondId, firstId);
  assert.equal(p.data.busy, false);
});

test('PP24 商品页余额不足：不请求，提示当前与所需积分', async () => {
  reset();
  summaryRespond = itemPageRespond({ balance: 199 });
  const def = loadPage(ITEM_JS);
  const p = bootWith(def);
  await tick();
  assert.equal(p.data.balance, 199);
  assert.ok(read(ITEM_WXML).includes('还差'), '余额不足要提示差额');

  apiCalls.length = 0;
  await p.onExchange();
  assert.deepEqual(calls(), [], '余额不足不能发兑换请求');
  assert.ok(toasts.some((t) => t.includes('当前 199')));
  assert.ok(toasts.some((t) => t.includes('需要 200')));
  assert.equal(p.data.busy, false);
});

test('PP25 商品页游客：不弹登录不发请求；点引导登录成功后才请求', async () => {
  reset({ loggedIn: false });
  const def = loadPage(ITEM_JS);
  const p = bootWith(def);
  await tick();
  assert.equal(loginCalls, 0);
  assert.deepEqual(calls(), []);
  assert.equal(p.data.loggedIn, false);
  assert.equal(p.data.loading, false);
  assert.ok(read(ITEM_WXML).includes('登录后'));

  loginAnswer = false;
  await p.onLoginTap();
  await tick();
  assert.equal(loginCalls, 1);
  assert.deepEqual(calls(), [], '取消登录不发请求');

  loginAnswer = true;
  appLoggedIn = true;
  summaryRespond = itemPageRespond({ balance: 200 });
  await p.onLoginTap();
  await tick();
  assert.deepEqual(calls(), ['GET /points/items', 'GET /points/summary']);
  assert.equal(p.data.loggedIn, true);
  assert.equal(p.data.item.price, 200);
});

test('PP26 商品页请求失败：failed 置位可点击重试，重试成功后恢复', async () => {
  reset();
  summaryRespond = () => Promise.reject(new Error('boom'));
  const def = loadPage(ITEM_JS);
  const p = bootWith(def);
  await tick();
  assert.equal(p.data.failed, true);
  assert.equal(p.data.loading, false);
  assert.ok(read(ITEM_WXML).includes('bindtap="onRetry"'));

  summaryRespond = itemPageRespond({ balance: 200 });
  await p.onRetry();
  await tick();
  assert.equal(p.data.failed, false);
  assert.equal(p.data.item.price, 200);
  assert.equal(p.data.balance, 200);
});

test('PP39 商品详情页按 ?key= 取商品：免广告卡走自己的兑换接口、不出补签块；无 key/未知 key 仍落补签卡', async () => {
  const adFree = {
    key: 'ad_free_7d',
    name: '免广告卡 7 天',
    subtitle: '7 天内免广告',
    price: 100,
    validDays: 7,
    description: '兑换后 7 天内免广告',
    notes: ['每张仅限本人使用', '兑换后不退积分'],
    effect: { kind: 'ad_free', days: 7 },
  };
  /** 两件在架商品，/points/summary 用 PP37 那份（含 makeup 格，余额够买免广告卡） */
  const twoItems = (p) => {
    if (p === '/points/items') return Promise.resolve([itemFixture(), adFree]);
    return Promise.resolve(Object.assign({}, summaryFixture(), { balance: 300 }));
  };
  const bootItemPage = (query) => {
    const def = loadPage(ITEM_JS);
    const p = Object.assign({}, def);
    p.data = JSON.parse(JSON.stringify(def.data));
    p.setData = (patch = {}) => Object.assign(p.data, patch);
    p.onLoad(query);
    return p;
  };

  reset();
  summaryRespond = twoItems;
  const p = bootItemPage({ key: 'ad_free_7d' });
  await tick();
  assert.equal(p.data.item.key, 'ad_free_7d');
  assert.equal(p.data.isMakeup, false, '免广告卡不是补签卡：我的补签卡/去补签/补签文案都不出');
  assert.equal(p.data.priceText, '100 积分兑换', '价格文案仍由这件商品的 price 拼');
  assert.equal(p.data.canMakeup, true, '可补判定照常从 cells 派生（只是非补签商品不显示入口）');
  assert.deepEqual(p.data.item.notes, adFree.notes, '兑换说明原样用服务端下发的 notes');

  apiCalls.length = 0;
  postRespond = () => Promise.resolve({});
  await p.onExchange();
  await tick();
  assert.equal(
    apiCalls.find((c) => c.method === 'POST').url,
    '/points/items/ad_free_7d/exchange',
    '兑换按这件商品自己的 key 提交，不再写死 makeup_card',
  );

  // 老链接（无 key）与未知 key 都回落第一项＝补签卡（服务端把 makeup_card 排最前）
  reset();
  summaryRespond = twoItems;
  const legacy = bootItemPage();
  await tick();
  assert.equal(legacy.data.item.key, 'makeup_card');
  assert.equal(legacy.data.isMakeup, true, 'effect 缺失的老商品按补签卡处理，补签块照常显示');

  reset();
  summaryRespond = twoItems;
  const unknown = bootItemPage({ key: 'nope' });
  await tick();
  assert.equal(unknown.data.item.key, 'makeup_card', 'key 查不到也不破，回落补签卡');

  // wxml：兑换说明是 notes 循环，补签文案按 isMakeup 二选一
  const wxml = read(ITEM_WXML);
  assert.ok(wxml.includes('wx:for="{{item.notes}}"'), '兑换说明按服务端 notes 循环');
  assert.ok(
    wxml.includes("{{isMakeup ? '登录后兑换补签卡' : '登录后兑换'}}"),
    '游客态文案按 isMakeup 分流：非补签商品读「登录后兑换」',
  );
});

test('PP27 兑换记录页：状态映射、未知状态兜底、时间与消耗格式化（行内补签入口已收口，见 PP38）', async () => {
  reset();
  const future = Date.now() + 86400000;
  const past = Date.now() - 86400000;
  const rows = [
    exchangeRow({ id: 'e1', status: 'unused', statusText: '未使用', expiresAt: future }),
    // 服务端已把过期未使用推导成 expired；页面再兜一层
    exchangeRow({ id: 'e2', status: 'unused', statusText: '未使用', expiresAt: past }),
    exchangeRow({ id: 'e3', status: 'used', statusText: '已使用', usedForDate: '2026-10-21', expiresAt: future }),
    exchangeRow({ id: 'e4', status: 'expired', statusText: '已过期', expiresAt: past }),
    // 未知状态不能当「未使用」；入口虽已删，状态归一（含过期兜底）仍是列表正确渲染的前提
    exchangeRow({ id: 'e5', status: 'mystery', statusText: '未使用', expiresAt: future }),
    // 四位数消耗：金额要千分位（免广告卡 600 还看不出来，1200 才看得出）
    exchangeRow({ id: 'e6', itemKey: 'ad_free_30d', status: 'expired', statusText: '已过期', expiresAt: past, cost: 1200 }),
  ];
  // 两个 GET 分流：兑换记录与实物订单各走各的接口（订单区是实物批次加的）
  summaryRespond = (url) => Promise.resolve(
    url === '/points/orders' || url === '/points/cards' ? [] : rows,
  );
  const def = loadPage(EX_JS);
  const p = bootWith(def);
  await tick();
  assert.deepEqual(calls(), ['GET /points/exchanges', 'GET /points/orders', 'GET /points/cards']);
  assert.equal(p.data.orders.length, 0, '没有订单时订单区不该凭空出行');
  assert.equal(p.data.ordersFailed, false, '订单接口正常返回时不许挂着「读不到」提示');
  assert.equal(p.data.loggedIn, true);
  assert.equal(p.data.loading, false);
  assert.deepEqual(p.data.items.map((i) => i.statusText), ['未使用', '已过期', '已使用', '已过期', '已过期', '已过期']);
  assert.deepEqual(p.data.items.map((i) => i.status), ['unused', 'expired', 'used', 'expired', 'expired', 'expired']);
  assert.ok(p.data.items.every((i) => i.canMakeup === undefined), '行数据不再自带可补判定——入口判据收口到积分页 cells');

  const ts = rows[0].createdAt;
  assert.equal(p.data.items[0].timeText, bjDateTime(ts));
  assert.equal(p.data.items[0].expiresText, bjDate(future));
  assert.equal(p.data.items[0].costText, '-200 积分');
  assert.equal(p.data.items[5].costText, '-1,200 积分', '四位数消耗也要千分位（订单卡与明细卡同口径）');
  assert.equal(p.data.items[2].usedForDateText, '10.21', '补掉的哪天：与积分页七格/胶囊同为 MM.DD 口径');

  const wxml = read(EX_WXML);
  assert.ok(wxml.includes('兑换时间'));
});

test('PP28 兑换记录页：游客不请求、空态文案、失败可重试', async () => {
  reset({ loggedIn: false });
  const def = loadPage(EX_JS);
  const p = bootWith(def);
  await tick();
  assert.equal(loginCalls, 0);
  assert.deepEqual(calls(), []);
  assert.equal(p.data.loggedIn, false);
  assert.equal(p.data.loading, false);
  assert.ok(read(EX_WXML).includes('登录后查看兑换记录'));

  loginAnswer = true;
  appLoggedIn = true;
  summaryRespond = () => Promise.resolve([]);
  await p.onLoginTap();
  await tick();
  assert.equal(loginCalls, 1);
  assert.deepEqual(calls(), ['GET /points/exchanges', 'GET /points/orders', 'GET /points/cards']);
  assert.equal(p.data.items.length, 0);
  assert.ok(read(EX_WXML).includes('还没有兑换记录'));
  // 两段都空才出空态：只有订单没有兑换记录时，不该说「还没有兑换记录」
  assert.ok(read(EX_WXML).includes('wx:elif="{{!orders.length}}"'), '空态判据要同时看订单');

  reset();
  summaryRespond = () => Promise.reject(new Error('boom'));
  const q = bootWith(def);
  await tick();
  assert.equal(q.data.failed, true);
  assert.equal(q.data.loading, false);

  summaryRespond = (url) => Promise.resolve(url === '/points/orders' || url === '/points/cards' ? [] : [exchangeRow()]);
  await q.onRetry();
  await tick();
  assert.equal(q.data.failed, false);
  assert.equal(q.data.items.length, 1);
  assert.equal(q.data.items[0].status, 'unused');
});

/* ------------- Task 8：其它两页补签入口按 cells 收口（spec §7 最后一条） ------------- */

test('PP37 商品页「去补签」入口以 cells 为准：有 makeup 格才出现，手里有卡但无可补日不出现', async () => {
  const bootItemPage = () => bootWith(loadPage(ITEM_JS));
  /** 商品页两路请求分流：/points/items 固定回商品，/points/summary 回指定 DTO */
  const summaryAs = (summary) => (p) => (p === '/points/items'
    ? Promise.resolve([itemFixture()])
    : Promise.resolve(summary));
  const signedAll = Object.assign({}, summaryFixture(), {
    signin: Object.assign({}, summaryFixture().signin, {
      cells: summaryFixture().signin.cells.map((c) => ({ ...c, state: 'signed' })),
    }),
  });

  reset();
  // ① fixture 的 cells 有 10-19/10-24 两颗 makeup 格 → 入口在
  summaryRespond = summaryAs(summaryFixture());
  const p = bootItemPage();
  await tick();
  assert.equal(p.data.failed, false);
  assert.equal(p.data.canMakeup, true, '有可补日 → 入口在');

  // ② 七格全已签、手里仍剩 2 张卡：没有可补的日子就不该再给入口（旧判据 cards > 0 正是本用例修的 bug）
  summaryRespond = summaryAs(signedAll);
  const q = bootItemPage();
  await tick();
  assert.equal(q.data.cards, 2, '卡还在手里，只是当下没得补');
  assert.equal(q.data.canMakeup, false, '有卡但无 makeup 格 → 入口不在');

  // ③ summary 缺 signin / 整个为空：按「无入口」处理，不能把整页顶成失败态
  summaryRespond = summaryAs({ balance: 10 });
  const r = bootItemPage();
  await tick();
  assert.equal(r.data.failed, false, 'signin 缺失不是页面失败');
  assert.equal(r.data.canMakeup, false);
  summaryRespond = summaryAs(null);
  const s = bootItemPage();
  await tick();
  assert.equal(s.data.failed, false);
  assert.equal(s.data.canMakeup, false);

  // ④ wxml 钉牢：链接的显示条件绑 canMakeup（由 cells 派生），文案不再写死「昨天」；
  //    非补签商品（免广告卡）也不该露这个入口，故与 isMakeup 同时成立才显示
  const wxml = read(ITEM_WXML);
  assert.ok(
    wxml.includes('<text class="link" wx:if="{{isMakeup && canMakeup}}" bindtap="goMakeup">去补签 ›</text>'),
    '链接整标签匹配：wx:if 是 isMakeup && canMakeup、文案是「去补签」（能补的不止昨天）',
  );
  assert.ok(!wxml.includes('去补签昨天'), '旧文案「去补签昨天」要删');
});

test('PP38 兑换记录页去掉行内「去补签」入口：按钮/判据/handler/wxss 一并收口，已用的卡仍显示补了哪天', async () => {
  reset();
  const future = Date.now() + 86400000;
  summaryRespond = () => Promise.resolve([
    exchangeRow({ id: 'e1', status: 'unused', expiresAt: future }),
    exchangeRow({ id: 'e3', status: 'used', usedForDate: '2026-10-21', expiresAt: future }),
  ]);
  const p = bootWith(loadPage(EX_JS));
  await tick();
  assert.equal(p.data.items[0].canMakeup, undefined, '行内入口的判据整个拿掉：行数据不带 canMakeup');
  assert.equal(p.data.items[1].usedForDateText, '10.21', '补签日期与积分页 cells/胶囊同用 MM.DD，不留一处 10-21 一处 10.21');

  const wxml = read(EX_WXML);
  const js = read(EX_JS);
  const wxss = read(EX_WXSS);
  assert.ok(!wxml.includes('exchange-action'), '行内补签按钮要删掉，它此前只看持卡状态');
  assert.ok(!js.includes('goMakeup') && !js.includes('canMakeup'), 'js 里的 goMakeup/canMakeup 一并删除');
  assert.ok(!wxss.includes('exchange-action'), '对应 wxss 规则同步删除，不留孤儿规则');
  assert.ok(wxml.includes('已补签'), '已用的卡仍要显示补了哪天');
  assert.ok(
    /<text class="exchange-used" wx:if="\{\{item\.usedForDateText\}\}">已补签 \{\{item\.usedForDateText\}\}<\/text>/.test(wxml),
    '「已补签 MM.DD」合成一句渲染：wx:if 与内容都走格式化字段，不在 wxml 里自拼',
  );
});

/* ---------------- 实物批次：订单区与地址表单（P7/P8） ---------------- */

test('PP40 兑换记录页订单区：三态渲染、只有已发货给确认、订单接口挂了不牵连兑换记录', async () => {
  reset();
  const base = Date.now();
  const orders = [
    { id: 'o1', itemKey: 'mi_band_11', itemName: '小米手环11标准版', cost: 28900, status: 'pending_ship', statusText: '待发货', address: { receiver: '张三', phone: '13800001234', detail: '广东省深圳市南山区' }, trackingNo: '', trackingCompany: '', shippedAt: 0, completedAt: 0, createdAt: base - 4000 },
    { id: 'o2', itemKey: 'mi_band_11', itemName: '小米手环11标准版', cost: 28900, status: 'shipped', statusText: '已发货', address: { receiver: '张三', phone: '13800001234', detail: '广东省深圳市南山区' }, trackingNo: 'SF1234', trackingCompany: '顺丰', shippedAt: base - 2000, completedAt: 0, createdAt: base - 3000 },
    { id: 'o3', itemKey: 'mi_band_11', itemName: '小米手环11标准版', cost: 28900, status: 'completed', statusText: '已完成', address: {}, trackingNo: 'SF1234', trackingCompany: '顺丰', shippedAt: base - 2000, completedAt: base - 1000, createdAt: base - 3000 },
    // 未知状态：文案原样显示（不硬套三档），更不能给一枚「确认收货」把人送进必然 400 的请求
    { id: 'o4', itemKey: 'x', itemName: '未知单', cost: 1, status: 'mystery', statusText: '', address: {}, trackingNo: '', trackingCompany: '', createdAt: base },
  ];
  summaryRespond = (url) => Promise.resolve(url === '/points/orders' ? orders : [exchangeRow()]);
  const p = bootWith(loadPage(EX_JS));
  await tick();
  assert.deepEqual(p.data.orders.map((o) => o.statusText), ['待发货', '已发货', '已完成', 'mystery']);
  assert.deepEqual(p.data.orders.map((o) => o.canConfirm), [false, true, false, false]);
  assert.equal(p.data.orders[0].addrPerson, '张三 13800001234', '收货人单独成行，「寄往」只当标签列');
  assert.equal(p.data.orders[1].trackingText, '顺丰 SF1234');
  assert.equal(p.data.orders[1].costText, '-28,900 积分', '金额千分位，与商品页 28,900 同口径');

  // 时间合成一行（MM-DD HH:mm）：下单必有、发货有才拼，同一天只写一次日期
  const c1 = bjDateTime(base - 3000);
  const s1 = bjDateTime(base - 2000);
  const sameDay = s1.slice(5, 10) === c1.slice(5, 10);
  assert.equal(p.data.orders[0].timeLine, `${bjDateTime(base - 4000).slice(5)} 下单`, '待发货只有下单时间');
  assert.equal(p.data.orders[1].timeLine, `${c1.slice(5)} 下单 · ${sameDay ? s1.slice(11) : s1.slice(5)} 发货`);

  // 三段式结构：头行（标题+状态+金额）→ 信息组（寄往/物流）→ 时间行 → 操作行（贴底右对齐）
  const wxml = read(EX_WXML);
  const block = wxml.slice(wxml.indexOf('wx:for="{{orders}}"'), wxml.indexOf('道具兑换记录'));
  assert.ok(
    /order-head[\s\S]*exchange-cost[\s\S]*order-meta[\s\S]*order-time[\s\S]*order-actions/.test(block),
    '金额要在头行、操作按钮要落到独立一行（别悬在卡片中部）',
  );
  assert.ok(/order-actions[\s\S]{0,220}?bindtap="onConfirmReceipt"/.test(block), '确认收货挂在操作行里');
  assert.equal(p.data.items.length, 1, '兑换记录照常显示');

  postRespond = () => Promise.resolve({ id: 'o2', status: 'completed' });
  await p.onConfirmReceipt({ currentTarget: { dataset: { id: 'o2' } } });
  await tick();
  const post = apiCalls.filter((c) => c.method === 'POST');
  assert.deepEqual(post.map((c) => c.url), ['/points/orders/o2/confirm']);
  assert.ok(toasts.includes('已确认收货'), `确认成功要有回执提示，实际 ${JSON.stringify(toasts)}`);

  // 订单接口挂掉：只提示订单读不到，兑换记录不能被连带白屏
  reset();
  summaryRespond = (url) => (url === '/points/orders' ? Promise.reject(new Error('boom')) : Promise.resolve([exchangeRow()]));
  const q = bootWith(loadPage(EX_JS));
  await tick();
  assert.equal(q.data.failed, false, '订单接口失败不该把整页判成加载失败');
  assert.equal(q.data.items.length, 1);
  assert.equal(q.data.orders.length, 0);
  assert.equal(q.data.ordersFailed, true);
});

test('PP41 商品页实物：地址不合法不发请求、通过才带 address 下单、成功后记住地址；虚拟商品请求体不变', async () => {
  const physical = Object.assign({}, itemFixture(), {
    key: 'mi_band_11',
    name: '小米手环11标准版',
    price: 28900,
    kind: 'physical',
    detailImages: ['https://oss/d1.png', '', 'https://oss/d2.png'],
    perUserLimit: 1,
    imageUrl: 'https://oss/hero.png',
  });
  const route = (item) => (url) => (url === '/points/items'
    ? Promise.resolve([item])
    : Promise.resolve(Object.assign({}, summaryFixture(), { balance: 30000 })));

  // 地址预填是跨用例的本地态，先清干净再测「没填」那一格
  wx.setStorageSync('points_addr_last', '');
  reset();
  summaryRespond = route(physical);
  const p = bootWith(loadPage(ITEM_JS));
  await tick();
  assert.equal(p.data.isPhysical, true);
  assert.deepEqual(p.data.detailImages, ['https://oss/d1.png', 'https://oss/d2.png'], '空串是脏数据，不该渲染成破图');
  assert.equal(p.data.heroImage, 'https://oss/hero.png');
  assert.equal(p.data.heroChar, '小', '没头图时用名称首字，别顶着写死的「签」');

  const posts = () => apiCalls.filter((c) => c.method === 'POST');
  await p.onExchange();
  await tick();
  assert.equal(posts().length, 0, '地址没填就不该发兑换请求（发了只拿到服务端 400）');
  assert.ok(p.data.addrErr, '要给可见的校验错误');

  const type = (field, value) => p.onAddrInput({ currentTarget: { dataset: { field } }, detail: { value } });
  type('receiver', '张三');
  type('phone', '1380000');
  type('detail', '广东省深圳市南山区科技园南路 1 号');
  assert.equal(p.data.addrErr, '', '改一个字就清掉上一次的报错，别让人对着旧提示找');
  await p.onExchange();
  await tick();
  assert.ok(p.data.addrErr.includes('手机号'), `要点名是哪一格不对，实际「${p.data.addrErr}」`);
  assert.equal(posts().length, 0);

  type('phone', '13800001234');
  postRespond = () => Promise.resolve({ orderId: 'o1', balance: 1100 });
  await p.onExchange();
  await tick();
  assert.equal(posts()[0].url, '/points/items/mi_band_11/exchange');
  assert.deepEqual(posts()[0].data.address, { receiver: '张三', phone: '13800001234', detail: '广东省深圳市南山区科技园南路 1 号' });
  assert.ok(toasts.includes('已下单，等待发货'), `实物说下单，别说「兑换成功」，实际 ${JSON.stringify(toasts)}`);
  assert.deepEqual(wx.getStorageSync('points_addr_last'), { receiver: '张三', phone: '13800001234', detail: '广东省深圳市南山区科技园南路 1 号' },
    '下次进本页预填上次的地址');

  // 虚拟商品：请求体只有 requestId（老契约一字不改），文案仍是「兑换成功」
  reset();
  summaryRespond = route(itemFixture());
  const v = bootWith(loadPage(ITEM_JS));
  await tick();
  assert.equal(v.data.isPhysical, false);
  postRespond = () => Promise.resolve({ cardId: 'c1', balance: 0 });
  await v.onExchange();
  await tick();
  const vp = apiCalls.filter((c) => c.method === 'POST')[0];
  assert.deepEqual(Object.keys(vp.data), ['requestId'], '虚拟商品的请求体不该被带上 address');
  assert.ok(toasts.includes('兑换成功'));
});

test('PP42 兑换记录页：物流单号可整串复制（微信物流接口对个人主体不开，复制是唯一闭环）', async () => {
  reset();
  const base = Date.now();
  const orders = [
    { id: 'o1', itemKey: 'mi_band_11', itemName: '小米手环11标准版', cost: 28900, status: 'shipped', statusText: '已发货', address: {}, trackingNo: '79026579651747', trackingCompany: '中通快递', shippedAt: base - 2000, completedAt: 0, createdAt: base - 3000 },
    // 待发货没有单号：复制入口不能渲染出来（wxml 以 trackingNo 为判据）
    { id: 'o2', itemKey: 'mi_band_11', itemName: '小米手环11标准版', cost: 28900, status: 'pending_ship', statusText: '待发货', address: {}, trackingNo: '', trackingCompany: '', shippedAt: 0, completedAt: 0, createdAt: base - 1000 },
  ];
  summaryRespond = (url) => Promise.resolve(url === '/points/orders' ? orders : [exchangeRow()]);
  const p = bootWith(loadPage(EX_JS));
  await tick();

  // 行数据要带裸单号（展示串含公司名前缀，复制进去会带脏字）
  assert.equal(p.data.orders[0].trackingNo, '79026579651747');
  assert.equal(p.data.orders[1].trackingNo, '');

  await p.onCopyTracking({ currentTarget: { dataset: { no: '79026579651747' } } });
  assert.equal(clipboard, '79026579651747', '复制的是裸单号，不是「中通快递 79026579651747」');
  assert.ok(toasts.includes('单号已复制'), `复制要有回执，实际 ${JSON.stringify(toasts)}`);

  // 空 dataset（节点没带单号）不能把剪贴板写成 undefined/空串
  clipboard = 'KEEP';
  await p.onCopyTracking({ currentTarget: { dataset: {} } });
  assert.equal(clipboard, 'KEEP');

  const wxml = read(EX_WXML);
  assert.ok(wxml.includes('bindtap="onCopyTracking"'), '物流行要挂复制 handler');
  assert.ok(wxml.includes('data-no="{{item.trackingNo}}"'), '复制内容从行数据的裸单号来');
  assert.ok(/wx:if="{{item.trackingNo}}"[\s\S]{0,120}?bindtap="onCopyTracking"/.test(wxml), '没有单号的行不渲染复制入口（判据与 handler 同在一个节点上）');
  assert.ok(wxml.includes('复制'), '可点区要有显式文字提示，不能只靠整行可点');
});

test('PP43 订单时间行：同一天只写一次日期，跨天发货带上自己的日期（钉死不随跑的时间漂）', async () => {
  reset();
  // 北京 10-27 13:57，避免用 Date.now() 让「同一天」在跨零点时变成另一个分支
  const t = Date.UTC(2026, 9, 27, 5, 57);
  const orders = [
    { id: 'a', itemName: '同日发', cost: 1, status: 'shipped', statusText: '已发货', address: {}, trackingNo: '', createdAt: t, shippedAt: t + 5 * 60000 },
    { id: 'b', itemName: '隔天发', cost: 1, status: 'shipped', statusText: '已发货', address: {}, trackingNo: '', createdAt: t, shippedAt: t + 2 * 86400000 + 5 * 60000 },
    { id: 'c', itemName: '未发货', cost: 1, status: 'pending_ship', statusText: '待发货', address: {}, trackingNo: '', createdAt: t, shippedAt: 0 },
  ];
  summaryRespond = (url) => Promise.resolve(url === '/points/orders' ? orders : []);
  const p = bootWith(loadPage(EX_JS));
  await tick();
  assert.deepEqual(p.data.orders.map((o) => o.timeLine), [
    '10-27 13:57 下单 · 14:02 发货',
    '10-27 13:57 下单 · 10-29 14:02 发货',
    '10-27 13:57 下单',
  ]);
});

test('PP45 我的卡：三来源全可见、文案与激活按钮只给未激活免广告卡、激活后重拉', async () => {
  reset();
  const future = Date.now() + 86400000;
  const past = Date.now() - 86400000;
  const cardRows = [
    // 后台发放的未激活免广告卡：能激活（用户报障的主角）
    { id: 'c1', itemKey: 'ad_free_7d', name: '免广告卡·7 天', kind: 'ad_free', status: 'unused',
      statusText: '待使用', benefitDays: 7, source: 'admin', sourceText: '后台发放', expiresAt: future },
    // 已激活生效中：没有按钮，meta 是到期区间
    { id: 'c2', itemKey: 'ad_free_30d', name: '免广告卡·30 天', kind: 'ad_free', status: 'active',
      statusText: '生效中', benefitDays: 30, source: 'exchange', sourceText: '兑换获得',
      startAt: Date.now() - 3600_000, endAt: Date.now() + 29 * 86400000, expiresAt: future },
    // 未使用的补签卡：没有按钮（走积分页「补」字）
    { id: 'c3', itemKey: 'makeup_card', name: '补签卡', kind: 'makeup', status: 'unused',
      statusText: '待使用', benefitDays: 0, source: 'system', sourceText: '系统赠送', expiresAt: future },
    // 排队中的第二张
    { id: 'c4', itemKey: 'ad_free_7d', name: '免广告卡·7 天', kind: 'ad_free', status: 'queued',
      statusText: '待生效', benefitDays: 7, source: 'exchange', sourceText: '兑换获得',
      startAt: Date.now() + 86400000, endAt: Date.now() + 8 * 86400000, expiresAt: future },
    // 过期的未激活卡：没按钮
    { id: 'c5', itemKey: 'ad_free_7d', name: '免广告卡·7 天', kind: 'ad_free', status: 'expired',
      statusText: '已过期', benefitDays: 7, source: 'exchange', sourceText: '兑换获得', expiresAt: past },
  ];
  summaryRespond = (url) => {
    if (url === '/points/orders') return Promise.resolve([]);
    if (url === '/points/cards') return Promise.resolve(cardRows);
    return Promise.resolve([]);
  };
  const p = bootWith(loadPage(EX_JS));
  await tick();
  assert.equal(p.data.cards.length, 5);
  assert.deepEqual(p.data.cards.map((c) => c.canActivate), [true, false, false, false, false],
    '只有未激活的免广告卡给「立即激活」');
  assert.ok(p.data.cards[0].metaText.includes('7 天免广告'), '未激活文案要带权益天数');
  assert.ok(p.data.cards[0].metaText.includes('前激活有效'));
  assert.ok(p.data.cards[1].metaText.includes('到期'));
  assert.ok(p.data.cards[2].metaText.includes('「补」字'), '补签卡指引去积分页用「补」字');
  assert.ok(p.data.cards[4].metaText.includes('已过期'));
  // 来源文案三来源齐全（发放/赠送不再隐形）
  assert.deepEqual([...new Set(p.data.cards.map((c) => c.sourceText))].sort(),
    ['兑换获得', '后台发放', '系统赠送']);
  assert.ok(read(EX_WXML).includes('我的卡'));
  assert.ok(read(EX_WXML).includes('onActivateCard'));

  // 激活闭环：POST 卡券激活接口 → 回执带 adFreeUntil → 静默重拉三接口
  apiCalls.length = 0;
  postRespond = (url) => {
    assert.equal(url, '/points/cards/c1/activate');
    return Promise.resolve({ cardId: 'c1', adFreeUntil: Date.now() + 7 * 86400000 });
  };
  await p.onActivateCard({ currentTarget: { dataset: { id: 'c1' } } });
  await tick();
  assert.deepEqual(calls(), [
    'POST /points/cards/c1/activate',
    'GET /points/exchanges', 'GET /points/orders', 'GET /points/cards',
  ], '激活成功后要重拉（卡状态从待使用变生效中）');
  assert.equal(p.data.activating, '');
});

test('PP44 兑换记录页下拉刷新：重拉两个接口、不闪骨架、完成或失败都收起下拉动画', async () => {
  const json = JSON.parse(read('miniprogram/pages/points-exchanges/points-exchanges.json'));
  assert.equal(json.enablePullDownRefresh, true, '不加这个配置，下拉手势根本不会派发 onPullDownRefresh');

  reset();
  summaryRespond = (url) => Promise.resolve(url === '/points/orders' || url === '/points/cards' ? [] : [exchangeRow()]);
  const p = bootWith(loadPage(EX_JS));
  await tick();
  assert.deepEqual(calls(), ['GET /points/exchanges', 'GET /points/orders', 'GET /points/cards']);

  // 记录每次 setData 的 patch，专门看 loading 有没有被翻成 true（翻 true 就会闪骨架）
  const patches = [];
  const setData = p.setData;
  p.setData = (patch = {}) => {
    patches.push(Object.assign({}, patch));
    setData(patch);
  };
  apiCalls.length = 0;
  pullStops = 0;

  summaryRespond = (url) => Promise.resolve(url === '/points/orders' || url === '/points/cards' ? [] : [exchangeRow({ id: 'e9' })]);
  await p.onPullDownRefresh();
  await tick();
  assert.deepEqual(calls(), ['GET /points/exchanges', 'GET /points/orders', 'GET /points/cards'], '下拉要把三个接口都重拉');
  assert.equal(p.data.items[0].id, 'e9', '新数据要落到页面');
  assert.ok(patches.every((x) => x.loading !== true), '静默刷新：已有内容不闪骨架');
  assert.equal(pullStops, 1, '完成后必须收起下拉动画');

  // 失败也要收起，否则动画一直转
  reset();
  summaryRespond = () => Promise.reject(new Error('boom'));
  await p.onPullDownRefresh();
  await tick();
  assert.equal(pullStops, 1);
  assert.equal(p.data.failed, true);
});

test('PP45 积分明细页下拉刷新：收回第一页重拉、不闪骨架、失败也收动画', async () => {
  const json = JSON.parse(read('miniprogram/pages/points-records/points-records.json'));
  assert.equal(json.enablePullDownRefresh, true, '没有这个配置下拉手势不会派发 onPullDownRefresh');

  reset();
  const pageOne = () => Array.from({ length: 20 }, (_, i) => recordItem({ id: `p1-${i}` }));
  summaryRespond = () => Promise.resolve({ balance: 47, items: pageOne() });
  const p = bootWith(loadPage(REC_JS));
  await tick();

  // 先翻到第二页：下拉要把分页状态收回第一页，而不是在第二页上追加
  summaryRespond = () => Promise.resolve({ balance: 47, items: Array.from({ length: 20 }, (_, i) => recordItem({ id: `p2-${i}` })) });
  await p.onReachBottom();
  await tick();
  assert.equal(p.data.page, 2, '前置：已经翻到第二页');

  const patches = [];
  const setData = p.setData;
  p.setData = (patch = {}) => {
    patches.push(Object.assign({}, patch));
    setData(patch);
  };
  apiCalls.length = 0;
  pullStops = 0;
  summaryRespond = () => Promise.resolve({ balance: 52, items: [recordItem({ id: 'r9', delta: 5 })] });
  await p.onPullDownRefresh();
  await tick();
  assert.deepEqual(calls(), ['GET /points/records'], '下拉只重拉第一页');
  assert.equal(p.data.page, 1, '分页状态收回第一页');
  assert.deepEqual(p.data.items.map((i) => i.id), ['r9'], '第一页结果替换列表，不和已翻出的行叠加');
  assert.equal(p.data.balance, 52, '余额也一起刷新');
  assert.ok(patches.every((x) => x.loading !== true), '静默刷新：已有内容不闪骨架');
  assert.equal(pullStops, 1, '完成后必须收起下拉动画');

  reset();
  summaryRespond = () => Promise.reject(new Error('boom'));
  await p.onPullDownRefresh();
  await tick();
  assert.equal(pullStops, 1, '失败也要收起下拉动画');
  assert.equal(p.data.failed, true);
});

test('PP46 商品详情页下拉刷新：重拉商品与汇总、不闪骨架、失败也收动画', async () => {
  const json = JSON.parse(read('miniprogram/pages/points-item/points-item.json'));
  assert.equal(json.enablePullDownRefresh, true, '没有这个配置下拉手势不会派发 onPullDownRefresh');

  reset();
  summaryRespond = (url) => Promise.resolve(url === '/points/items' ? [itemFixture()] : summaryFixture());
  const p = bootWith(loadPage(ITEM_JS));
  await tick();
  assert.equal(p.data.balance, 42);

  const patches = [];
  const setData = p.setData;
  p.setData = (patch = {}) => {
    patches.push(Object.assign({}, patch));
    setData(patch);
  };
  apiCalls.length = 0;
  pullStops = 0;
  // 后台改价/改余额后下拉要能拿到新值
  summaryRespond = (url) => Promise.resolve(url === '/points/items'
    ? [Object.assign({}, itemFixture(), { price: 300 })]
    : Object.assign({}, summaryFixture(), { balance: 999 }));
  await p.onPullDownRefresh();
  await tick();
  assert.deepEqual(calls(), ['GET /points/items', 'GET /points/summary'], '商品与汇总都要重拉');
  assert.equal(p.data.balance, 999);
  assert.equal(p.data.item.price, 300);
  assert.equal(p.data.priceText, '300 积分兑换', '按钮文案跟着新价格走');
  assert.ok(patches.every((x) => x.loading !== true), '静默刷新：已有内容不闪骨架');
  assert.equal(pullStops, 1);

  reset();
  summaryRespond = () => Promise.reject(new Error('boom'));
  await p.onPullDownRefresh();
  await tick();
  assert.equal(pullStops, 1, '失败也要收起下拉动画');
  assert.equal(p.data.failed, true);
});

test('PP47 积分兑换区「兑换记录」进专页：要能看到订单与卡状态，不是把明细筛一遍', async () => {
  reset();
  const p = boot();
  await tick();
  navs.length = 0;
  p.goExchangeRecords();
  assert.deepEqual(
    navs, ['/pages/points-exchanges/points-exchanges'],
    '兑换记录页才有「我的订单 + 道具兑换记录（状态/有效期）」，明细筛 type=exchange 看不到这些',
  );
});

test('PP48 每日多次任务：页面透传剩余次数并渲染副行（看视频 3 次）', async () => {
  reset();
  const p = boot();
  await tick();
  const video = p.data.taskGroups.dailyTasks.find((t) => t.key === 'daily_video');
  assert.deepEqual([video.times, video.timesLeft, video.timesText], [3, 2, '今日还剩 2 次']);
  assert.equal(video.disabled, false, '还剩次数时按钮要可点');

  const wxml = read('miniprogram/pages/points/points.wxml');
  assert.ok(/task-sub[\s\S]{0,80}?item\.timesText/.test(wxml), '副行文案要来自派生字段，不在 wxml 里拼');
});

test('PP49 道具卡：副标题单行省略，有效期与库存走服务端字段、由页面一次渲染成 meta 行', () => {
  const wxml = read('miniprogram/pages/points/points.wxml');
  assert.ok(wxml.includes('{{item.subtitle}}'), '副标题单独一行');
  assert.ok(!/item\.subtitle\}\}\s*·/.test(wxml), '有效期不能继续拼在副标题后面（会从中间折断）');
  assert.ok(wxml.includes('{{item.metaText}}'), '有效期/库存由派生字段一次渲染');
  assert.ok(/item-meta/.test(wxml));

  const wxss = read('miniprogram/pages/points/points.wxss');
  const sub = wxss.slice(wxss.indexOf('.item-sub'), wxss.indexOf('.item-sub') + 200);
  assert.ok(/white-space:\s*nowrap/.test(sub) && /text-overflow:\s*ellipsis/.test(sub), '长副标题单行省略，不折行');
});

test('PP50 商品详情图：整宽竖排、按原比例自适应高度（不再横滑 220rpx 方图）', () => {
  const wxml = read(ITEM_WXML);
  assert.ok(!/detail-scroll|scroll-x="true"/.test(wxml), '详情图不再横向滑动');
  assert.ok(/class="detail-list"/.test(wxml), '竖排容器');
  assert.ok(/mode="widthFix"/.test(wxml), '宽度占满、高度按原比例自适应');
  assert.ok(/class="detail-img"[\s\S]{0,80}?mode="widthFix"/.test(wxml), 'widthFix 要挂在详情图节点上');

  const wxss = read('miniprogram/pages/points-item/points-item.wxss');
  const start = wxss.indexOf('.detail-img');
  const block = wxss.slice(start, start + 200);
  assert.ok(/width:\s*100%/.test(block), '详情图宽度占满');
  assert.ok(!/height:\s*\d/.test(block), '不写死高度，交给 widthFix 自适应');
});

test('PP51 商品页底部安全区：购买栏垫 safe-area，滚动留白也随安全区加高（否则最后一块被盖住）', () => {
  const wxss = read('miniprogram/pages/points-item/points-item.wxss');
  const bar = wxss.slice(wxss.indexOf('.buy-bar'), wxss.indexOf('.buy-bar') + 260);
  assert.ok(/padding:[^;]*env\(safe-area-inset-bottom\)/.test(bar), '购买栏底部要垫 env(safe-area-inset-bottom)，否则被 Home 条压住');

  const space = wxss.slice(wxss.indexOf('.buy-space'), wxss.indexOf('.buy-space') + 160);
  assert.ok(/calc\([^)]*env\(safe-area-inset-bottom\)/.test(space), '滚动区尾部留白也要加安全区，否则内容被栏盖住');
  const heightRpx = Number((space.match(/(\d+)rpx/) || [])[1]);
  assert.ok(heightRpx >= 170, `留白至少覆盖「提示行+按钮+内边距」（实测约 179rpx），实际 ${heightRpx}rpx`);
});

test('PP52 道具卡图位：有道具图走整宽图位，没图才回落到名称首字方块', () => {
  const wxml = read('miniprogram/pages/points/points.wxml');
  assert.ok(
    /<image[^>]*class="item-art"[^>]*src="{{item\.imageUrl}}"[^>]*mode="aspectFill"/.test(wxml),
    '图位节点要挂 item.imageUrl 并裁切填满（签名链由服务端下发）',
  );
  assert.ok(
    /class="item-art"[\s\S]{0,220}?<view wx:else class="item-glyph"/.test(wxml),
    '缺图时 wx:else 回落首字占位，别留白块',
  );
  const wxss = read('miniprogram/pages/points/points.wxss');
  const art = wxss.slice(wxss.indexOf('.item-art'), wxss.indexOf('.item-art') + 200);
  assert.ok(/height:\s*\d+rpx/.test(art) && /border-radius/.test(art), '图位要有固定高度与圆角（否则 aspectFill 撑不出来）');
});

test('PP53 商品详情头图不被裁：横版道具图用 aspectFit，图位框按图片比例给宽高', () => {
  const wxml = read(ITEM_WXML);
  const tag = (wxml.match(/<image[^>]*class="hero-img"[^>]*>/) || [])[0] || '';
  assert.ok(tag, '头图节点要在');
  assert.ok(/mode="aspectFit"/.test(tag), 'aspectFill 会把 2.1:1 的道具图裁成中间一条');

  const wxss = read('miniprogram/pages/points-item/points-item.wxss');
  const block = wxss.slice(wxss.indexOf('.hero-img'), wxss.indexOf('.hero-img') + 220);
  const w = Number((block.match(/width:\s*(\d+)rpx/) || [])[1]);
  const h = Number((block.match(/height:\s*(\d+)rpx/) || [])[1]);
  assert.ok(w && h, '图位要给显式宽高');
  const ratio = w / h;
  assert.ok(ratio > 1.9 && ratio < 2.3, `图位宽高比要贴着道具图的 2.1:1，实际 ${ratio.toFixed(2)}（方框会裁图）`);
});

/* ------------------- 2026-10-28 改版：积分卡 / 签到卡头 / 月历半屏 ------------------- */

test('PP60 结构：积分卡独立在前，签到卡头改成连签天数 + 百分位，月历组件已注册', () => {
  const wxml = read('miniprogram/pages/points/points.wxml');
  const pts = wxml.indexOf('class="card points-card"');
  const sign = wxml.indexOf('class="card signin-card"');
  assert.ok(pts > 0 && sign > pts, '紧凑积分卡要排在签到卡之前');
  // 余额与两个入口留在积分卡内；连签与百分位占掉签到卡头（原余额位）
  const head = wxml.slice(pts, sign);
  assert.ok(head.includes('{{balance}}') && head.includes('goRecords') && head.includes('goRules'),
    '积分卡内要有余额 + 明细 + 规则');
  assert.ok(head.includes('wx:if="{{expiring}}"') && head.includes('天后过期'),
    '过期提醒按服务端下发的 expiring 条件渲染，端上不判阈值');
  const card = wxml.slice(sign, wxml.indexOf('每日任务'));
  assert.ok(card.includes('连签 {{signin.streakDay}} 天') && card.includes('{{streakSub}}'),
    '签到卡头是连签天数与百分位副题');
  assert.ok(card.includes('openCalendar') && card.includes('签到日历 ›'), '入口要有文字与箭头，不能靠猜');
  assert.ok(card.includes('wx:for="{{strip}}"'), '七格仍留在签到卡内（用户点名保留）');
  assert.ok(wxml.includes('<signin-calendar'), '月历半屏挂在页面尾部');
  const json = JSON.parse(read('miniprogram/pages/points/points.json'));
  assert.ok((json.usingComponents || {})['signin-calendar'], '组件要在页面 json 里注册');
});

test('PP61 打开月历才取数：GET /points/signin/calendar 带当月，失败只在弹窗内降级', async () => {
  reset();
  const p = boot();
  await tick();
  assert.deepEqual(calls(), ['GET /points/summary'], '进页不该顺手拉月历');
  p.openCalendar();
  await tick();
  const { currentMonth } = require('../miniprogram/utils/footprint-calendar.js');
  assert.deepEqual(calls(), ['GET /points/summary', 'GET /points/signin/calendar']);
  const cal = apiCalls.find((c) => c.url === '/points/signin/calendar');
  assert.equal(cal.params.month, currentMonth(), '缺省拉当月');
  assert.equal(p.data.calVisible, true);

  // 翻月：换 month 重拉
  p.onCalMonthChange({ detail: { month: '2026-05' } });
  await tick();
  assert.equal(apiCalls.filter((c) => c.url === '/points/signin/calendar').length, 2);
  assert.equal(apiCalls[apiCalls.length - 1].params.month, '2026-05');

  // 失败：只置 calFailed，整页内容与登录态不受影响
  summaryRespond = (url) => (url === '/points/signin/calendar'
    ? Promise.reject(new Error('boom')) : Promise.resolve(summaryFixture()));
  p.onCalRetry();
  await tick();
  assert.equal(p.data.calFailed, true);
  assert.equal(p.data.failed, false, '局部失败不能顶掉整页');
  assert.equal(p.data.loggedIn, true);
});

test('PP62 补签流程七格与月历共用：无卡落兑换页不发请求，有卡弹确认后 POST', async () => {
  reset();
  const p = boot();
  await tick();
  p.setData({ cards: 0 });
  p.onCalMakeup({ detail: { dateKey: '2026-10-19' } });
  assert.deepEqual(calls(), ['GET /points/summary'], '没卡就不该发补签请求');
  assert.equal(navs[navs.length - 1], '/pages/points-item/points-item', '无卡要落去兑换页');

  p.setData({ cards: 1 });
  // 历史月的 missed：端上不拦（2026-10-28 拍板），照常发请求由接口回 400 文案
  p.onCalMakeup({ detail: { dateKey: '2026-03-11' } });
  assert.equal(modals.length, 1, '点漏签日要弹确认');
  assert.ok(modals[0].content.includes('03.11'), `确认文案带 MM.DD：${modals[0].content}`);
  assert.equal(modals[0].content.includes('今天可拿'), false, '历史日没有 todayRewardAfter，不该编那半句');
  postRespond = () => Promise.resolve({ credited: 4, toppedUp: 2 });
  await tick();
  const mk = apiCalls.find((c) => c.url === '/points/signin/makeup');
  assert.equal(mk.data.dateKey, '2026-03-11');
});

test('PP63 弹窗开着时补签/签到成功要顺手重拉月历，关着不多打一次', async () => {
  reset();
  const p = boot();
  await tick();
  postRespond = () => Promise.resolve({ credited: 4, toppedUp: 2 });
  p.setData({ cards: 1 });
  p.onMakeup({ currentTarget: { dataset: { dateKey: '2026-10-19' } } });
  await tick();
  assert.equal(apiCalls.filter((c) => c.url === '/points/signin/calendar').length, 0,
    '从没打开过：只刷汇总');

  // 打开过再关掉也要停：calMonth 留着上次的值，此时若无条件重拉就是白打一次请求
  p.openCalendar();
  await tick();
  assert.equal(apiCalls.filter((c) => c.url === '/points/signin/calendar').length, 1);
  p.closeCalendar();
  p.onMakeup({ currentTarget: { dataset: { dateKey: '2026-10-24' } } });
  await tick();
  assert.equal(apiCalls.filter((c) => c.url === '/points/signin/calendar').length, 1,
    '弹窗关着时刷新汇总就够了，别管 calMonth 里还留着哪个月');

  p.openCalendar();
  await tick();
  const before = apiCalls.filter((c) => c.url === '/points/signin/calendar').length;
  p.onCalMakeup({ detail: { dateKey: '2026-10-19' } });
  await tick();
  assert.equal(apiCalls.filter((c) => c.url === '/points/signin/calendar').length, before + 1,
    '弹窗开着时，补签成功后的汇总刷新要顺手重拉当月格子');
});

test('PP64 概览文案：百分位与过期提醒都来自接口，连签 0 天不出现「超过 0% 用户」', async () => {
  reset();
  summaryRespond = () => Promise.resolve(Object.assign({}, summaryFixture(), {
    expiring: { points: 84, daysLeft: 23 },
    streakPercentile: 75,
  }));
  let p = boot();
  await tick();
  assert.equal(p.data.streakSub, '超过 75% 用户');
  assert.deepEqual(p.data.expiring, { points: 84, daysLeft: 23 });

  reset();
  summaryRespond = () => Promise.resolve(Object.assign({}, summaryFixture(), {
    signin: Object.assign({}, summaryFixture().signin, { streakDay: 0 }),
  }));
  p = boot();
  await tick();
  assert.equal(p.data.streakSub, '今天签到开启连签', '0 天时不报「超过 0% 用户」');
  assert.equal(p.data.expiring, null, '服务端没下发就是 null，整行不渲染');
});

test('PP65 月历里的兑换入口：绑到页面方法且显式带补签卡 key', () => {
  const wxml = read('miniprogram/pages/points/points.wxml');
  assert.match(wxml, /bind:exchange="goMakeupItem"/, '组件 exchange 事件要接住');
  const js = read('miniprogram/pages/points/points.js');
  assert.match(js, /goMakeupItem\(\)\s*\{[\s\S]{0,120}points-item\?key=makeup_card/,
    '要显式带 key，不能靠详情页回落第一项');
});

/* ------------------- 2026-10-28 商品详情顶部改版（hero 带 + 价格行，底色最终定白） ------------------- */

/** WCAG 对比度：色值守卫不比字符串，改色值前先过 4.5（#fff 与 #ffffff 同解） */
const hex6 = (h) => (h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h);
const relLum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex6(hex).slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratioOf = (fg, bg) => {
  const [hi, lo] = [relLum(fg), relLum(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
};
/** 取某条 css 规则的声明块（只到第一个右花括号，别把下一条的规则体算进来） */
const cssBlock = (css, selector) => {
  const at = css.indexOf(`${selector} {`);
  assert.ok(at >= 0, `样式里找不到 ${selector} 规则`);
  return css.slice(at, css.indexOf('}', at));
};
const cssColor = (block) => (block.match(/color:\s*(#[0-9a-fA-F]{6})/) || [])[1];

test('PP66 顶部 hero：白底带独立在首卡之前，名称/副题在左、道具图在右', () => {
  const wxml = read(ITEM_WXML);
  const wxss = read('miniprogram/pages/points-item/points-item.wxss');
  const heroAt = wxml.indexOf('<view class="hero">');
  const cardAt = wxml.indexOf('<view class="card">');
  assert.ok(heroAt >= 0, 'hero 带要在（它是整块深色底，塞进白卡里会露白边）');
  assert.ok(cardAt > heroAt, 'hero 带独立在首卡之前');
  const heroBody = wxml.slice(heroAt, cardAt);
  assert.ok(heroBody.includes('class="hero-main"'), '名称/副题成一块');
  assert.ok(heroBody.indexOf('class="hero-main"') < heroBody.indexOf('class="hero-img"'),
    '左文右图：文字块要在图位之前（老版是图在左、价在右）');
  assert.ok(/<image[^>]*class="hero-img"[^>]*wx:if|class="hero-img"/.test(heroBody)
    && heroBody.includes('wx:if="{{heroImage}}"') && heroBody.includes('wx:else class="hero-icon"'),
    '有图用图、缺图回落首字方块，两条都得留在 hero 里');
  // 老结构必须真删了：留着会和白底价格行重复一遍
  assert.ok(!wxml.includes('class="item-head"'), '旧的横向商品头要撤掉');

  const heroBg = (cssBlock(wxss, '.hero').match(/background:\s*(#[0-9a-fA-F]{3,6})/) || [])[1];
  assert.ok(heroBg, 'hero 要有底色');
  // 2026-10-28 用户改口要白底（深灰蓝 A2 撤掉）：这条钉住「浅底」，别哪天又漂回深色
  assert.ok(relLum(heroBg) > 0.9, `hero 底色要够浅（白底），实际 ${heroBg}`);

  const name = cssColor(cssBlock(wxss, '.hero-name'));
  const sub = cssColor(cssBlock(wxss, '.hero-sub'));
  assert.ok(ratioOf(name, heroBg) >= 4.5, `商品名 ${name} 在 ${heroBg} 上只有 ${ratioOf(name, heroBg).toFixed(2)}:1`);
  assert.ok(ratioOf(sub, heroBg) >= 4.5, `副题 ${sub} 在 ${heroBg} 上只有 ${ratioOf(sub, heroBg).toFixed(2)}:1`);
  // 缺图回落的首字方块：字要在自己的浅灰底上够清楚（不比色值字符串）
  const icon = cssBlock(wxss, '.hero-icon');
  const iconBg = (icon.match(/background:\s*(#[0-9a-fA-F]{3,6})/) || [])[1];
  assert.ok(iconBg && ratioOf(cssColor(icon), iconBg) >= 4.5, `回落首字 ${cssColor(icon)} on ${iconBg} 看不清`);
});

test('PP67 价格行：价格独立成大字 + 库存胶囊共用 stockTextOf，商品名不在这里重复第二遍', () => {
  const wxml = read(ITEM_WXML);
  const js = read(ITEM_JS);
  const wxss = read('miniprogram/pages/points-item/points-item.wxss');
  const row = wxml.slice(wxml.indexOf('<view class="price-row">'), wxml.indexOf('</view>', wxml.indexOf('stock-pill')));
  assert.ok(row.includes('{{priceNumberText}}'), '大字价格用派生字段（千分位），不直接铺原始数');
  assert.ok(row.includes('wx:if="{{stockText}}"'), '库存胶囊按服务端口径条件渲染，缺字段就整颗不出现');
  assert.ok(!row.includes('item.name'), '名称已在 hero 里，价格行不再重复一遍');

  // 与积分页共用同一份库存文案口径（不限量/剩余 N 件），端上别各写一套
  assert.match(js, /require\('\.\.\/\.\.\/utils\/points-view'\)/);
  assert.match(js, /stockText:\s*item \? stockTextOf\(item\.stockLeft\) : ''/);
  const { stockTextOf } = require('../miniprogram/utils/points-view');
  assert.equal(stockTextOf(null), '不限量');
  assert.equal(stockTextOf(3), '剩余 3 件');
  assert.equal(stockTextOf(undefined), '', '老接口没下发 stockLeft 时不能猜成不限量');

  const numBlock = cssBlock(wxss, '.price-num');
  const numSize = Number((numBlock.match(/font-size:\s*(\d+)rpx/) || [])[1]);
  assert.ok(numSize >= 44, `价格要够分量（实际 ${numSize}rpx）`);
  const cardBg = '#ffffff';
  for (const sel of ['.price-num', '.price-unit', '.stock-pill']) {
    const block = cssBlock(wxss, sel);
    const fg = cssColor(block);
    const bg = sel === '.stock-pill' ? (block.match(/background:\s*(#[0-9a-fA-F]{6})/) || [])[1] : cardBg;
    assert.ok(fg && bg && ratioOf(fg, bg) >= 4.5, `${sel} ${fg} on ${bg} = ${ratioOf(fg || '', bg || '').toFixed(2)}:1 低于 4.5`);
    if (sel === '.stock-pill') {
      // 胶囊要有自己的底色，跟白卡同色就只剩一行裸字，看不出这是个状态标记
      assert.notEqual(bg, cardBg, '库存胶囊的底色不能和白卡一样');
    }
  }
});

/* ------------------- 规则页榜单段落 / 商品今日剩余（Task 12） ------------------- */

const RULES_WXML = 'miniprogram/pages/points-rules/points-rules.wxml';
const RULES_JS = 'miniprogram/pages/points-rules/points-rules.js';

/** 去注释后再做「不许写死榜单分值」的源码守卫：注释里出现同名字样不该把守卫骗成红/绿 */
const stripWxmlComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '');

test('PP68 规则页榜单段落走服务端文案：wxml 里不许出现写死的榜单分值', () => {
  const wxml = stripWxmlComments(read(RULES_WXML));
  // 锚定「周/月/年榜 + 数字 + 分」这种句式（注释已剥掉）：分值只许来自接口 boardRules
  for (const period of ['周榜', '月榜', '年榜']) {
    assert.ok(
      // 锚在渲染文本里的「周榜……分」句式上（中间允许「第 1 名」这类数字片段）；
      // 注释已在上面剥掉，不会因为注释里写了同样一句就把守卫骗红/骗绿
      !new RegExp(`${period}[^\\n]{0,40}?\\d+\\s*分`).test(wxml),
      `规则页里不该出现写死的${period}分值（分值由服务端 boardRules 下发）`,
    );
  }
  assert.ok(wxml.includes('wx:for="{{boardRules}}"'), '榜单奖励整段由服务端 boardRules 数组渲染');
  assert.ok(wxml.includes('{{item}}'), '逐句渲染服务端文案本身，不在端上二次拼数字');
  // 不许回落硬编码文案：JS 里也不留备份的六句（同一条正则守住）
  assert.ok(!/周榜[^0-9]{0,12}\d+\s*分/.test(read(RULES_JS)), 'JS 里同样不许写死榜单分值');
});

test('PP69 商品卡/详情页显示「今日剩余 N 张」，不限（null）时整行不渲染', () => {
  const cardWxml = read('miniprogram/pages/points/points.wxml');
  assert.ok(cardWxml.includes('wx:if="{{item.todayText}}"'), '整行按派生 todayText 条件渲染（null ⇒ 空串 ⇒ 不渲染）');
  assert.ok(cardWxml.includes('{{item.todayText}}'), '文案整句来自 utils/points-view，wxml 不拼数字');
  assert.ok(!/item\.todayLeft\s*[-+*]/.test(cardWxml), '端上不许自己算今日剩余');

  const itemWxml = read(ITEM_WXML);
  assert.ok(itemWxml.includes('wx:if="{{todayText}}"'), '详情页 meta 行与列表卡同口径条件渲染');
  assert.ok(itemWxml.includes('{{todayText}}'), '详情页同样渲染整句，不自己拼「今日剩余」+数字');
  const itemJs = read(ITEM_JS);
  assert.match(itemJs, /todayLeftTextOf/, '详情页复用 utils/points-view 的今日剩余口径');
  assert.match(itemJs, /todayText:\s*item \? todayLeftTextOf\(item\.todayLeft\) : ''/);

  const { todayLeftTextOf } = require('../miniprogram/utils/points-view');
  assert.equal(todayLeftTextOf(null), '', '不限投放（null）⇒ 空串 ⇒ 整行不渲染');
  assert.equal(todayLeftTextOf(undefined), '', '老接口缺字段也不渲染（别猜成不限或 0）');
  assert.equal(todayLeftTextOf(2), '今日剩余 2 张');
  assert.equal(todayLeftTextOf(0), '今日剩余 0 张', '当日抢完显示 0，不是隐藏');
});

test('PP70 规则页从 GET /points/rules 读榜单数组；请求失败整段缺席（不回落硬编码）', async () => {
  reset();
  summaryRespond = (p) => {
    assert.equal(p, '/points/rules', '规则页只该取公开的 /points/rules');
    return Promise.resolve({ boardRules: ['服务端第一句', '服务端第二句'] });
  };
  const def = loadPage(RULES_JS);
  const p = bootWith(def);
  await tick();
  assert.deepEqual(p.data.boardRules, ['服务端第一句', '服务端第二句'], '整段文案原样落到页面数据');
  assert.ok(apiCalls.some((c) => c.url === '/points/rules'), '进页即取一次榜单文案');

  // 失败：静默（不弹 toast、不进 failed 块），静态段落照常，榜单段落因空数组整段不渲染
  reset();
  summaryRespond = () => Promise.reject(new Error('network down'));
  const def2 = loadPage(RULES_JS);
  const p2 = bootWith(def2);
  await tick();
  assert.deepEqual(p2.data.boardRules, [], '失败时保持空数组 ⇒ wx:if 让榜单段落缺席');
  assert.equal(toasts.length, 0, '规则页失败不打扰用户');
});

test('PP71 实物商品页不加「长期目标/需要稳定上榜」说明（spec §4.8 明确不加）', () => {
  for (const p of [ITEM_WXML, ITEM_JS, RULES_WXML, RULES_JS,
    'miniprogram/pages/points/points.wxml', 'miniprogram/utils/points-view.js']) {
    assert.ok(!/长期目标|稳定上榜/.test(read(p)), `${p} 不该出现「长期目标/稳定上榜」类说明文案`);
  }
});

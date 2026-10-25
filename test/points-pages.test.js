/**
 * 积分主页（pages/points/points）与个人中心入口回归：
 * 1) 结构：app.json 注册路由、我的页有入口、积分页有签到/任务/补签卡/明细/规则；
 * 2) 登录闸门走触点级：游客进页不弹登录、不发请求，只有点「登录后查看积分」才 ensureLogin + 拉汇总；
 * 3) 汇总只读 /points/summary，映射余额/cells 七格/补签胶囊/任务行/道具卡；
 * 4) 签到与任务领取走 POST；补签走 POST /points/signin/makeup {dateKey}（卡由服务端挑，前端不传卡 id）；
 *    激励视频只有完播（isEnded===true）才领分，提前关闭/广告失败都不发分；
 * 5) 积分明细页（PP12–PP16）：触点到 /points/records 才发请求、分页 20 条、+N/-N 与余额、失败重试；
 * 6) 积分规则页（PP12/PP17）：静态 Q&A 覆盖连续签到/次日失效/有效期/每日上限/补签卡。
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
  assert.ok(wxml.includes('{{item.validDays}} 天有效'), '兑换卡有效期要渲染接口下发的 validDays');
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
    { key: 'profile', title: '完善资料', points: 10, status: 'claimable', actionText: '领取' },
    { key: 'daily_video', title: '每日看视频', points: 5, status: 'claimable', actionText: '去观看' },
  ],
  items: [{ key: 'makeup_card', name: '补签卡', subtitle: '恢复连续打卡记录', price: 30, validDays: 30 }],
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
const { isAdRewardEligible } = require(adPath); // 完播判定用真实实现
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
global.wx = {
  showToast: (o) => toasts.push(o && o.title),
  navigateTo: (o) => navs.push(o && o.url),
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

test('PP4 登录用户进页：只读一次汇总并映射余额/cells 七格/补签胶囊/任务/道具卡', async () => {
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
  assert.deepEqual(p.data.strip.map((s) => s.dot), ['补', '✓', '✓', '未', '✓', '补', '+1']);
  assert.deepEqual(p.data.strip.map((s) => s.reward), [1, 1, 2, 0, 3, 4, 1], '分值原样带出 cells 的名义分');
  assert.ok(
    p.data.strip.every((s) => /^(今天|明天|\d{2}\.\d{2})$/.test(s.sub)),
    'sub 只能是「今天/明天/MM.DD」三种（由纯函数按 dateKey 比对）',
  );
  assert.equal(p.data.chips.length, 2, '两个 makeup 格各一颗胶囊');
  assert.deepEqual(
    p.data.tasks.map((t) => [t.key, t.actionText, t.disabled]),
    [['profile', '领取', false], ['daily_video', '去观看', false], ['daily_activity', '已领取', true]],
    '接口把已领取排在最前，页面要按「未完成在前」重排',
  );
  assert.equal(p.data.items.length, 1);
  assert.deepEqual(p.data.items[0], {
    key: 'makeup_card', name: '补签卡', subtitle: '恢复连续打卡记录', price: 30, validDays: 30, glyph: '补',
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

test('PP5c 道具区是卡片列表：一个道具一张卡，图位用名称首字', () => {
  const wxml = read('miniprogram/pages/points/points.wxml');
  assert.ok(/wx:for="{{items}}"/.test(wxml), '道具区要按接口下发的商品表循环，不能写死一张');
  assert.ok(wxml.includes('class="item-card"'), '每个道具一张卡（不是原来那行「标题+箭头」）');
  assert.ok(wxml.includes('{{item.glyph}}'), '卡上图位用派生好的首字，不在 wxml 里拼字符串');
  assert.ok(wxml.includes('持有 {{cards}} 张'), '持卡数要在卡上带出来，兑换前就该知道自己有几张');
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

  await p.onClaim({ currentTarget: { dataset: { key: 'profile' } } });
  await tick();
  assert.deepEqual(calls(), ['POST /points/tasks/profile/claim', 'GET /points/summary']);
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

test('PP29 补签胶囊：确认弹窗带 MM.DD 日期与补完分值 → POST /points/signin/makeup {dateKey} → 刷新', async () => {
  reset();
  const p = boot();
  await tick();
  assert.equal(p.data.chips.length, 2, '19 与 24 各一颗');
  assert.deepEqual(p.data.chips.map((c) => c.dateKey), ['2026-10-19', '2026-10-24']);
  postRespond = () => Promise.resolve({ credited: 1, toppedUp: 4 });
  const tap = { currentTarget: { dataset: { dateKey: '2026-10-19' } } };
  p.onMakeup(tap);
  p.onMakeup(tap); // makeupBusy 闸门：第一发还在飞时连点不能再发请求
  assert.equal(modals.length, 2, '两次点击都进确认弹窗，第二次在闸门处被挡下');
  assert.ok(modals[0].content.includes('10.19'), '弹窗日期与胶囊/七格同为 MM.DD，不打 ISO 日期');
  assert.ok(modals[0].content.includes('今天可拿'), '要提前告知补完的效果');
  await tick();
  assert.deepEqual(apiCalls.filter((c) => c.method === 'POST').map((c) => `${c.url} ${JSON.stringify(c.data)}`),
    ['/points/signin/makeup {"dateKey":"2026-10-19"}'], '一次链路只发一次请求，体里只有 dateKey、没有卡 id');
  assert.ok(toasts.some((t) => t.includes('补签成功 +1')));
  assert.ok(toasts.some((t) => t.includes('另补发 4 分')));
  assert.equal(apiCalls.filter((c) => c.url === '/points/summary').length, 2, '成功后要重拉拿最新格子');
  assert.equal(p.makeupBusy, false, '落地后闸门要复位');
});

test('PP30 取消确认不发请求；无卡时点胶囊跳兑换页而不是发请求', async () => {
  reset();
  const p = boot();
  await tick();
  modalAnswer = false;
  p.onMakeup({ currentTarget: { dataset: { dateKey: '2026-10-19' } } });
  await tick();
  assert.deepEqual(calls().filter((c) => c.startsWith('POST')), [], '取消不能发请求');
  modalAnswer = true;
  p.setData({ cards: 0, chips: [{ dateKey: '2026-10-19', label: '补签 10.19', sub: '去兑换', hasCard: false }] });
  p.onMakeup({ currentTarget: { dataset: { dateKey: '2026-10-19' } } });
  await tick();
  assert.deepEqual(calls().filter((c) => c.startsWith('POST')), []);
  assert.deepEqual(navs, ['/pages/points-item/points-item'], '无卡要落到兑换页');
  assert.equal(modals.length, 1, '无卡不弹确认，此前只有取消那一次');

  // chips 里没有的日期点不动：入口与 cells 同源，防陈旧/伪造的 dataset（卡仍由服务端挑）
  p.onMakeup({ currentTarget: { dataset: { dateKey: '2026-10-22' } } });
  await tick();
  assert.equal(navs.length, 1, '不在 chips 里的日期既不跳转也不发请求');
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

test('PP34 连签 ≥7：显示「已连续 N 天 · 每日 7 分」，未满 7 天不显示', async () => {
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
  }));
  const p = boot();
  await tick();
  assert.equal(p.data.streakText, '已连续 9 天 · 每日 7 分');
  assert.ok(read('miniprogram/pages/points/points.wxml').includes('{{streakText}}'), '签到卡内要渲染连续天数文案');

  reset(); // fixture 只有连签 2 天
  const q = boot();
  await tick();
  assert.equal(q.data.streakText, '', '未满 7 天不显示该文案');
});

test('PP35 七格与胶囊同源：cells 里没有 makeup 格时不出现补签入口', async () => {
  reset();
  summaryRespond = () => Promise.resolve(Object.assign({}, summaryFixture(), {
    signin: Object.assign({}, summaryFixture().signin, {
      cells: summaryFixture().signin.cells.map((c) => (c.state === 'makeup' ? { ...c, state: 'missed' } : c)),
    }),
  }));
  const p = boot();
  await tick();
  assert.deepEqual(p.data.chips, []);
  assert.ok(!p.data.strip.some((s) => s.state === 'makeup'), '七格里也没有 makeup 格');

  const wxml = read('miniprogram/pages/points/points.wxml');
  const js = read('miniprogram/pages/points/points.js');
  assert.ok(!wxml.includes('makeup-link'), '旧的单条补签链接要删掉');
  assert.ok(!js.includes('canMakeUp') && !js.includes('makeupCardId') && !js.includes('makeupDate'),
    '后端已删的 canMakeUp/makeupDate/makeupCardId 前端不能再读');
  assert.ok(wxml.includes('<view class="chip-row" wx:if="{{chips.length}}">'), '胶囊行由 chips 空否把关，与 cells 同源');
  assert.ok(wxml.includes('<view class="makeup-note" wx:if="{{chips.length}}">'), '说明行同样跟 chips 同源，不留常驻噪声');
  assert.ok(wxml.includes('data-date-key'), '胶囊点击回传 dateKey，服务端按日校验');
  assert.ok(wxml.includes('bindtap="onMakeup"'), '胶囊绑定补签入口');
  assert.ok(wxml.includes('class="signin-cell {{item.state}}"'), '七格配色由 cells.state 驱动');
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

/** 单独加载某个页面（页面模块在 require 时通过 Page() 交出定义） */
function loadPage(relPath) {
  let def = null;
  const prev = global.Page;
  global.Page = (d) => {
    def = d;
  };
  const abs = require.resolve(path.join(root, relPath));
  delete require.cache[abs];
  require(abs);
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

test('PP17 规则页覆盖连续签到/第 7 天/断签/次日/视频/次年/每日 100/补签卡 200 分 30 天只补昨天', () => {
  const rules = read('miniprogram/pages/points-rules/points-rules.wxml');
  ['连续签到', '第 7 天', '断签', '次日', '视频', '次年', '100', '200', '30 天', '昨天'].forEach((s) => {
    assert.ok(rules.includes(s), `规则页缺少「${s}」`);
  });
  assert.ok(rules.includes('min(N, 7)'), '连续签到奖励应写明 min(N, 7)');
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
const EX_JS = 'miniprogram/pages/points-exchanges/points-exchanges.js';
const EX_WXML = 'miniprogram/pages/points-exchanges/points-exchanges.wxml';

const itemFixture = () => ({
  key: 'makeup_card',
  name: '补签卡',
  subtitle: '恢复连续打卡记录',
  price: 200,
  validDays: 30,
  description: '每张仅可使用一次；仅用于补签昨天；兑换后 30 天内有效',
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
  assert.ok(item.includes('makeup_card/exchange'));
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
  ['每张', '昨天', '不退'].forEach((s) => assert.ok(wxml.includes(s), `兑换说明缺少「${s}」`));
  assert.ok(wxml.includes('{{item.validDays}} 天内有效'), '有效期天数由接口 validDays 拼出，不写死 30');
  assert.ok(!wxml.includes('30 天'), 'WXML 里不能再硬编码 30 天');
  assert.ok(wxml.includes('我的补签卡'), '已有未使用卡时展示「我的补签卡 N 张」');
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

test('PP27 兑换记录页：状态映射、去补签条件（未使用且未过期）、时间与消耗格式化', async () => {
  reset();
  const future = Date.now() + 86400000;
  const past = Date.now() - 86400000;
  const rows = [
    exchangeRow({ id: 'e1', status: 'unused', statusText: '未使用', expiresAt: future }),
    // 服务端已把过期未使用推导成 expired；页面再兜一层
    exchangeRow({ id: 'e2', status: 'unused', statusText: '未使用', expiresAt: past }),
    exchangeRow({ id: 'e3', status: 'used', statusText: '已使用', usedForDate: '2026-10-21', expiresAt: future }),
    exchangeRow({ id: 'e4', status: 'expired', statusText: '已过期', expiresAt: past }),
    // 未知状态不能当「未使用」放出补签入口，按已过期兜底
    exchangeRow({ id: 'e5', status: 'mystery', statusText: '未使用', expiresAt: future }),
  ];
  summaryRespond = () => Promise.resolve(rows);
  const def = loadPage(EX_JS);
  const p = bootWith(def);
  await tick();
  assert.deepEqual(calls(), ['GET /points/exchanges']);
  assert.equal(p.data.loggedIn, true);
  assert.equal(p.data.loading, false);
  assert.deepEqual(p.data.items.map((i) => i.statusText), ['未使用', '已过期', '已使用', '已过期', '已过期']);
  assert.deepEqual(p.data.items.map((i) => i.canMakeup), [true, false, false, false, false]);

  const ts = rows[0].createdAt;
  assert.equal(p.data.items[0].timeText, bjDateTime(ts));
  assert.equal(p.data.items[0].expiresText, bjDate(future));
  assert.equal(p.data.items[0].costText, '-200 积分');
  assert.equal(p.data.items[2].usedForDate, '2026-10-21');

  const wxml = read(EX_WXML);
  assert.ok(wxml.includes('bindtap="goMakeup"'), '未使用且未过期要有「去补签」入口');
  assert.ok(wxml.includes('去补签'));
  assert.ok(wxml.includes('兑换时间'));

  p.goMakeup();
  assert.deepEqual(navs, ['/pages/points/points']);
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
  assert.deepEqual(calls(), ['GET /points/exchanges']);
  assert.equal(p.data.items.length, 0);
  assert.ok(read(EX_WXML).includes('还没有兑换记录'));

  reset();
  summaryRespond = () => Promise.reject(new Error('boom'));
  const q = bootWith(def);
  await tick();
  assert.equal(q.data.failed, true);
  assert.equal(q.data.loading, false);

  summaryRespond = () => Promise.resolve([exchangeRow()]);
  await q.onRetry();
  await tick();
  assert.equal(q.data.failed, false);
  assert.equal(q.data.items.length, 1);
  assert.equal(q.data.items[0].canMakeup, true);
});

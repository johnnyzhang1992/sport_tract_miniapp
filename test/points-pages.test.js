/**
 * 积分主页（pages/points/points）与个人中心入口回归：
 * 1) 结构：app.json 注册路由、我的页有入口、积分页有签到/任务/补签卡/明细/规则；
 * 2) 登录闸门走触点级：游客进页不弹登录、不发请求，只有点「登录后查看积分」才 ensureLogin + 拉汇总；
 * 3) 汇总只读 /points/summary，映射余额/签到条/任务行/补签卡；
 * 4) 签到与任务领取走 POST；激励视频只有完播（isEnded===true）才领分，提前关闭/广告失败都不发分；
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

test('PP2 积分页：签到/任务/兑换入口存在', () => {
  const wxml = read('miniprogram/pages/points/points.wxml');
  assert.ok(wxml.includes('今日签到') || wxml.includes('明日签到'));
  assert.ok(wxml.includes('补签卡'));
  assert.ok(wxml.includes('积分规则'));
  assert.ok(wxml.includes('积分明细'));
});

/* --------------------------------- 环境桩 --------------------------------- */

const apiCalls = [];
let summaryRespond = null;
let postRespond = null;

const summaryFixture = () => ({
  balance: 42,
  signin: { todaySigned: false, streakDay: 2, nextReward: 3, canMakeUp: true, makeupDate: '2026-10-23', cards: 2 },
  tasks: [
    { key: 'profile', title: '完善资料', points: 10, status: 'claimable', actionText: '领取' },
    { key: 'daily_video', title: '每日看视频', points: 5, status: 'claimable', actionText: '去观看' },
    { key: 'daily_activity', title: '每日运动', points: 5, status: 'claimed', actionText: '已领取' },
  ],
  item: { key: 'makeup_card', price: 30, validDays: 30 },
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
global.wx = {
  showToast: (o) => toasts.push(o && o.title),
  navigateTo: (o) => navs.push(o && o.url),
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

test('PP4 登录用户进页：只读一次汇总并映射余额/签到条/任务/补签卡', async () => {
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
  assert.equal(p.data.strip[1].done, true);
  assert.equal(p.data.strip[2].current, true);
  assert.deepEqual(
    p.data.tasks.map((t) => [t.key, t.actionText, t.disabled]),
    [['profile', '领取', false], ['daily_video', '去观看', false], ['daily_activity', '已领取', true]],
  );
  assert.equal(p.data.item.price, 30);
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

test('PP10 入口跳转：明细/规则/补签卡/带 makeup 参数的补签页', async () => {
  reset();
  const p = boot();
  await tick();
  p.goRecords();
  p.goRules();
  p.goItem();
  p.onMakeup();
  assert.deepEqual(navs, [
    '/pages/points-records/points-records',
    '/pages/points-rules/points-rules',
    '/pages/points-item/points-item',
    '/pages/points-item/points-item?makeup=1',
  ]);
});

test('PP11 汇总失败：failed 置位但页面不崩', async () => {
  reset();
  summaryRespond = () => Promise.reject(new Error('boom'));
  const p = boot();
  await tick();
  assert.equal(p.data.failed, true);
  assert.equal(p.data.loading, false);
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
  ['每张', '昨天', '30 天', '不退'].forEach((s) => assert.ok(wxml.includes(s), `兑换说明缺少「${s}」`));
  assert.ok(wxml.includes('我的补签卡'), '已有未使用卡时展示「我的补签卡 N 张」');
  assert.ok(wxml.includes('兑换记录'));
  assert.ok(wxml.includes('bindtap="goExchanges"'));

  p.goExchanges();
  assert.deepEqual(navs, ['/pages/points-exchanges/points-exchanges']);
});

test('PP23 商品页兑换：POST 带一次性 requestId、busy 期间连点不重复提交、成功后刷新', async () => {
  reset();
  summaryRespond = itemPageRespond({ balance: 200 });
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
  await pending;
  await tick();
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
  ];
  summaryRespond = () => Promise.resolve(rows);
  const def = loadPage(EX_JS);
  const p = bootWith(def);
  await tick();
  assert.deepEqual(calls(), ['GET /points/exchanges']);
  assert.equal(p.data.loggedIn, true);
  assert.equal(p.data.loading, false);
  assert.deepEqual(p.data.items.map((i) => i.statusText), ['未使用', '已过期', '已使用', '已过期']);
  assert.deepEqual(p.data.items.map((i) => i.canMakeup), [true, false, false, false]);

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

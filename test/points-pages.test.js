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
const { bjDate } = require('../miniprogram/utils/bj-date');

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
  post(p) {
    apiCalls.push({ method: 'POST', url: p });
    return Promise.resolve({});
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

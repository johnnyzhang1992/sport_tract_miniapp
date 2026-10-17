/**
 * 首页概览区（pages/index/index.js 的 loadOverview / loadLeaderboardSummary / onShow 节流）页级回归。
 *
 * 背景：首页原来自个儿打 4 个接口（overview / footprint / trend365 / leaderboard + 串行周期回退）。
 * 现在三段并入 GET /stats/home、榜摘要并入 GET /stats/leaderboard-regions?me=1。
 * 合并**不能**把 3cb2d5e 修掉的「一个接口挂掉、整块卡片消失」请回来 —— 所以服务端按段返回
 * {ok,data|error}，端上仍要：失败文案落到自己那张卡上、旧值不清空、全绿才写缓存、卡内可重试。
 * 另外 60s 内切回首页不重复全量拉取；登录态变化或 homeDirty 时无视 TTL 立刻重拉。
 *
 * 运行：npm test；桩：wx / Page / getApp 就地 stub，services/api 用 require.cache 注入假实现。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

/* ---------------------------------- 环境桩 ---------------------------------- */

const apiCalls = [];
/** 用例内改写：(path) => Promise<data>，reject 即模拟整个请求失败 */
let respond = () => Promise.resolve({});
const fakeApi = {
  get(p) {
    apiCalls.push(p);
    return respond(p);
  },
};
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };

const storage = new Map();
let toastTitles = [];
global.wx = {
  getStorageSync: (k) => (storage.has(k) ? storage.get(k) : ''),
  setStorageSync: (k, v) => storage.set(k, v),
  removeStorageSync: (k) => storage.delete(k),
  showToast: (o) => toastTitles.push(o && o.title),
  nextTick: (cb) => cb(),
  stopPullDownRefresh: () => {},
};
let pageDef = null;
global.Page = (def) => { pageDef = def; };

/** 登录态 / 本地会话要能被用例改写；用 getter 让闭包变量与桩对象始终一致 */
let loggedIn = true;
let session = true;
const appStub = {
  hasSession: () => session,
  globalData: {},
  maybeShowProfileGuide: () => {},
  login: async () => { loggedIn = true; },
};
Object.defineProperty(appStub.globalData, 'loggedIn', { get: () => loggedIn });
appStub.globalData.api = fakeApi;
appStub.globalData.homeDirty = false;
appStub.globalData.userInfo = null;
global.getApp = () => appStub;

require('../miniprogram/pages/index/index.js');
assert.ok(pageDef, 'index.js 应通过 Page() 交出页面对象');

const CACHE_KEY = 'indexOverviewCache_v1';

/* --------------------------------- 页面装配 --------------------------------- */

function makePage() {
  const p = Object.assign({}, pageDef);
  p.data = JSON.parse(JSON.stringify(pageDef.data));
  p.setData = (patch) => Object.assign(p.data, patch);
  return p;
}

const flush = () => new Promise((r) => setImmediate(r));

/** /stats/home 的三段全绿响应 */
function healthySections() {
  return {
    overview: { ok: true, data: { total: { count: 32, distance: 153650 } } },
    footprint: { ok: true, data: { provinceCount: 3, cityCount: 5 } },
    heat: {
      ok: true,
      data: { data: Array.from({ length: 365 }, (_, i) => ({ date: `2026-01-${i % 28 + 1}`, distance: i })) },
    },
  };
}

/** 三个接口全绿的默认桩 */
function healthy() {
  respond = (p) => {
    if (p === '/stats/home') return Promise.resolve(healthySections());
    if (p === '/stats/leaderboard-regions?me=1') return Promise.resolve({ totalUsers: 27, me: { period: null, ranks: [] } });
    if (p === '/topics/active') return Promise.resolve([]);
    if (p === '/campaigns?role=joined') return Promise.resolve({ items: [] });
    return Promise.resolve({});
  };
}

/** 只让合并响应里的某一段失败，其余保持绿 */
function failSection(key, message) {
  respond = (p) => {
    if (p === '/stats/home') {
      const s = healthySections();
      s[key] = { ok: false, error: message };
      return Promise.resolve(s);
    }
    if (p === '/stats/leaderboard-regions?me=1') return Promise.resolve({ totalUsers: 27, me: { period: null, ranks: [] } });
    return Promise.resolve({});
  };
}

function resetEnv() {
  apiCalls.length = 0;
  toastTitles = [];
  storage.clear();
  loggedIn = true;
  session = true;
  respond = () => Promise.resolve({});
  appStub.globalData.homeDirty = false;
  appStub.globalData.userInfo = null;
}

/* ---------------------------------- 用例 ---------------------------------- */

test('H1 累计数据段失败不连累日历：日历照常落地，失败文案挂在概览卡上', async () => {
  resetEnv();
  failSection('overview', '网络请求失败，请检查后端服务是否启动');
  const p = makePage();
  await p.loadOverview();

  assert.equal(p.data.heatData.length, 365, 'overview 失败不该把日历一起拖没');
  assert.match(p.data.overviewError, /累计数据/, '失败提示要点名是哪张卡');
  assert.match(p.data.overviewError, /后端服务是否启动/, '提示要带上实际原因，不能只说「加载失败」');
  assert.equal(p.data.totalOverview, null, '拿不到数据就不该编一个 0 出来');
});

test('H2 日历段失败：概览照常展示，旧日历不清空且提示原因', async () => {
  resetEnv();
  healthy();
  const p = makePage();
  await p.loadOverview();
  assert.equal(p.data.heatData.length, 365);

  failSection('heat', '网络超时，请检查网络后重试');
  await p.loadOverview();

  assert.equal(p.data.heatData.length, 365, '刷新失败要保留屏上旧数据，不能刷成空白');
  assert.match(p.data.heatError, /运动日历/);
  assert.match(p.data.heatError, /网络超时/);
  assert.equal(p.data.totalOverview.trackCount, 32, '概览不受日历失败影响');
});

test('H3 省市段失败：屏上数字保留，失败提示单独挂一条', async () => {
  resetEnv();
  healthy();
  const p = makePage();
  await p.loadOverview();
  assert.equal(p.data.totalOverview.provinceCount, 3);

  failSection('footprint', '请求失败(500)');
  await p.loadOverview();

  assert.equal(p.data.totalOverview.provinceCount, 3, '省市挂了不该把 3 省刷成 0');
  assert.equal(p.data.totalOverview.cityCount, 5);
  assert.match(p.data.footprintError, /点亮省市/);
  assert.match(p.data.footprintError, /500/);
});

test('H4 重试成功后三条失败提示各自清掉', async () => {
  resetEnv();
  healthy();
  const p = makePage();
  respond = (p2) => {
    if (p2 === '/stats/home') {
      return Promise.resolve({
        overview: { ok: false, error: 'boom1' },
        footprint: { ok: false, error: 'boom3' },
        heat: { ok: false, error: 'boom2' },
      });
    }
    return Promise.resolve({});
  };
  await p.loadOverview();
  assert.ok(p.data.overviewError && p.data.heatError && p.data.footprintError, '先确认三条都置上了');

  healthy();
  await p.loadOverview();
  assert.equal(p.data.overviewError, null);
  assert.equal(p.data.heatError, null);
  assert.equal(p.data.footprintError, null);
});

test('H5 部分成功不写缓存（下次冷启动不拿半套数据当最新）', async () => {
  resetEnv();
  healthy();
  const p = makePage();
  await p.loadOverview();
  const full = storage.get(CACHE_KEY);
  assert.ok(full && full.totalOverview && full.heatData.length === 365, '全绿时要写缓存');

  storage.clear();
  failSection('overview', 'down');
  await p.loadOverview();
  assert.equal(storage.has(CACHE_KEY), false, '有段失败时不要落盘');
});

test('H6 卡内「重试」只重打这一个合并接口', async () => {
  resetEnv();
  healthy();
  const p = makePage();
  failSection('overview', 'down');
  await p.loadOverview();
  apiCalls.length = 0;

  healthy();
  p.data.loading = true;
  await p.retryOverview();

  assert.deepEqual(apiCalls, ['/stats/home'], '三段已合并，一次请求即可');
  assert.equal(p.data.overviewError, null);
  assert.equal(p.data.totalOverview.trackCount, 32);
  assert.equal(p.data.loading, false, '重试结束后要收掉 loading');
});

test('H7 游客态：不发请求、不留失败提示', async () => {
  resetEnv();
  loggedIn = false;
  session = false;
  const p = makePage();
  await p.loadOverview();

  assert.deepEqual(apiCalls, []);
  assert.equal(p.data.heatError, null);
  assert.equal(p.data.overviewError, null);
  assert.equal(p.data.notLoggedIn, true);
});

test('H8 整个请求失败：屏上仍是缓存值，但三段都要如实标出来', async () => {
  resetEnv();
  healthy();
  const seeded = makePage();
  await seeded.loadOverview();
  apiCalls.length = 0;
  respond = () => Promise.reject(new Error('down'));

  const p = makePage();
  await p.loadOverview();

  assert.equal(p.data.totalOverview.trackCount, 32, '接口全挂时屏上仍是缓存值');
  assert.equal(p.data.heatData.length, 365);
  assert.ok(p.data.overviewError && p.data.heatError && p.data.footprintError, '但三段失败要如实标出来');
  assert.match(p.data.heatError, /运动日历：down/, '整请求失败时也要带上原因');
});

test('H9 榜摘要一次请求：label 用服务端给的周期，不再端上探 4 个周期', async () => {
  resetEnv();
  respond = (p) => {
    if (p === '/stats/leaderboard-regions?me=1') {
      return Promise.resolve({
        totalUsers: 27,
        me: {
          period: 'month',
          ranks: [
            { type: 'walking', rank: 2 },
            { type: 'running', rank: 5 },
          ],
        },
      });
    }
    return Promise.resolve({});
  };

  const page = makePage();
  await page.loadLeaderboardSummary();

  assert.deepEqual(apiCalls, ['/stats/leaderboard-regions?me=1'], '一次拿全：人数 + 名次');
  assert.equal(page.data.lbSummary.totalUsers, 27);
  assert.deepEqual(page.data.lbSummary.ranks.map((r) => r.label), ['散步月榜', '跑步月榜']);
});

test('H10 卡片最多 1+2=3 行：三条上榜也只展示前两条排名', async () => {
  resetEnv();
  respond = (p) => {
    if (p === '/stats/leaderboard-regions?me=1') {
      return Promise.resolve({
        totalUsers: 27,
        me: {
          period: 'week',
          ranks: [
            { type: 'walking', rank: 2 },
            { type: 'running', rank: 5 },
            { type: 'hiking', rank: 1 },
          ],
        },
      });
    }
    return Promise.resolve({});
  };

  const page = makePage();
  await page.loadLeaderboardSummary();

  assert.equal(page.data.lbSummary.ranks.length, 2, '排名行截到 2 条，加上「全国 N 位迹路者」共 3 行');
  assert.deepEqual(page.data.lbSummary.ranks.map((r) => r.type), ['walking', 'running'], '按后端返回顺序取前两条');
});

test('H10b 老服务端不带 me 字段：人数照常展示，名次退化为空（不崩、不编造）', async () => {
  resetEnv();
  respond = (p) => (p === '/stats/leaderboard-regions?me=1' ? Promise.resolve({ totalUsers: 27 }) : Promise.resolve({}));

  const page = makePage();
  await page.loadLeaderboardSummary();

  assert.equal(page.data.lbSummary.totalUsers, 27);
  assert.deepEqual(page.data.lbSummary.ranks, []);
});

test('H11 默认运动类型直接从登录返回的用户读数，不再打 /users/me', async () => {
  resetEnv();
  appStub.globalData.userInfo = { settings: { defaultType: 'cycling' } };

  const p = makePage();
  await p.applyDefaultType();

  assert.deepEqual(apiCalls, [], 'login 已下发 user.settings，设置页保存也会写回 globalData');
  assert.equal(p.data.selectedType, 'cycling');
});

test('H12 onShow 节流：60s 内切回不重复拉；过期 / 脏标记 / 登录态变化才重拉', async () => {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    resetEnv();
    healthy();
    const p = makePage();

    p.onShow();
    await flush();
    assert.ok(apiCalls.length >= 3, '首屏要拉（overview / 榜摘要 / 专题 / 活动）');
    const firstBatch = apiCalls.length;

    apiCalls.length = 0;
    now += 10_000;
    p.onShow();
    await flush();
    assert.deepEqual(apiCalls, [], '60s 内切回首页不发请求');

    now += 60_000;
    p.onShow();
    await flush();
    assert.equal(apiCalls.length, firstBatch, '超过 TTL 重新拉同一批');

    apiCalls.length = 0;
    appStub.globalData.homeDirty = true; // 刚跑完 / 刚加入活动
    p.onShow();
    await flush();
    assert.equal(apiCalls.length, firstBatch, '脏标记无视 TTL');
    assert.equal(appStub.globalData.homeDirty, false, '消费后要清掉，否则会一直重拉');

    apiCalls.length = 0;
    session = false; // 登出（token 没了）
    p.onShow();
    await flush();
    assert.ok(apiCalls.length > 0, '登录态变化要立刻重拉，不能被 TTL 挡住');

    apiCalls.length = 0;
    session = true; // 重新登录回来（上一段模拟了登出）
    p.onPullDownRefresh(); // 下拉是显式刷新，必须越过 TTL
    await flush();
    assert.equal(apiCalls.length, firstBatch, '下拉刷新重拉整屏四块');
  } finally {
    Date.now = realNow;
  }
});

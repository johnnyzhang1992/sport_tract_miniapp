/**
 * 首页概览区（pages/index/index.js 的 loadOverview）页级回归。
 * 为什么要测：日历卡与累计数据卡原先共用一个 Promise.all，`/stats/overview` 一失败整块 reject，
 * 只 console.error → 卡片静默消失，用户只看到「日历不见了」（2026-09-23 现场）。修法是各接口独立
 * 降级 + 失败文案落到自己那张卡上（含接口名与实际原因）+ 卡内点击重试。
 * 运行：npm test；桩：wx / Page / getApp 就地 stub，services/api 用 require.cache 注入假实现。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

/* ---------------------------------- 环境桩 ---------------------------------- */

const apiCalls = [];
/** 用例内改写：(path) => Promise<data>，reject 即模拟该接口失败 */
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
  showToast: (o) => toastTitles.push(o && o.title),
  nextTick: (cb) => cb(),
  stopPullDownRefresh: () => {},
};
let pageDef = null;
global.Page = (def) => { pageDef = def; };
let loggedIn = true;
global.getApp = () => ({
  hasSession: () => loggedIn,
  globalData: { loggedIn, api: fakeApi },
  maybeShowProfileGuide: () => {},
  login: async () => {},
});

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

/** 三个接口全绿的默认桩 */
function healthy() {
  respond = (p) => {
    if (p === '/stats/overview') return Promise.resolve({ total: { count: 32, distance: 153650 } });
    if (p === '/stats/footprint') return Promise.resolve({ provinceCount: 3, cityCount: 5 });
    if (p === '/stats/trend?days=365') {
      return Promise.resolve({ data: Array.from({ length: 365 }, (_, i) => ({ date: `2026-01-${i % 28 + 1}`, distance: i })) });
    }
    return Promise.resolve({});
  };
}

/** 只让某个接口失败，其余保持绿 */
function failOnly(badPath, message) {
  const ok = respond;
  respond = (p) => (p === badPath ? Promise.reject(new Error(message)) : ok(p));
}

function resetEnv() {
  apiCalls.length = 0;
  toastTitles = [];
  storage.clear();
  loggedIn = true;
  respond = () => Promise.resolve({});
}

/* ---------------------------------- 用例 ---------------------------------- */

test('H1 累计数据接口失败不连累日历：日历照常落地，失败文案挂在概览卡上', async () => {
  resetEnv();
  healthy();
  failOnly('/stats/overview', '网络请求失败，请检查后端服务是否启动');
  const p = makePage();
  await p.loadOverview();

  assert.equal(p.data.heatData.length, 365, 'overview 失败不该把日历一起拖没');
  assert.match(p.data.overviewError, /累计数据/, '失败提示要点名是哪个接口');
  assert.match(p.data.overviewError, /后端服务是否启动/, '提示要带上实际原因，不能只说「加载失败」');
  assert.equal(p.data.totalOverview, null, '拿不到数据就不该编一个 0 出来');
});

test('H2 日历接口失败：概览照常展示，旧日历不清空且提示原因', async () => {
  resetEnv();
  healthy();
  const p = makePage();
  await p.loadOverview();
  assert.equal(p.data.heatData.length, 365);

  failOnly('/stats/trend?days=365', '网络超时，请检查网络后重试');
  await p.loadOverview();

  assert.equal(p.data.heatData.length, 365, '刷新失败要保留屏上旧数据，不能刷成空白');
  assert.match(p.data.heatError, /运动日历/);
  assert.match(p.data.heatError, /网络超时/);
  assert.equal(p.data.totalOverview.trackCount, 32, '概览不受日历失败影响');
});

test('H3 省市接口失败：屏上数字保留，失败提示单独挂一条', async () => {
  resetEnv();
  healthy();
  const p = makePage();
  await p.loadOverview();
  assert.equal(p.data.totalOverview.provinceCount, 3);

  failOnly('/stats/footprint', '请求失败(500)');
  await p.loadOverview();

  assert.equal(p.data.totalOverview.provinceCount, 3, '省市接口挂了不该把 3 省刷成 0');
  assert.equal(p.data.totalOverview.cityCount, 5);
  assert.match(p.data.footprintError, /点亮省市/);
  assert.match(p.data.footprintError, /500/);
});

test('H4 重试成功后三条失败提示各自清掉', async () => {
  resetEnv();
  healthy();
  const p = makePage();
  failOnly('/stats/overview', 'boom1');
  failOnly('/stats/trend?days=365', 'boom2');
  failOnly('/stats/footprint', 'boom3');
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
  failOnly('/stats/overview', 'down');
  await p.loadOverview();
  assert.equal(storage.has(CACHE_KEY), false, '有接口失败时不要落盘');
});

test('H6 卡内「重试」把三个接口重新拉一遍并复用同一条落地路径', async () => {
  resetEnv();
  healthy();
  const p = makePage();
  failOnly('/stats/overview', 'down');
  await p.loadOverview();
  apiCalls.length = 0;

  healthy();
  p.data.loading = true;
  await p.retryOverview();

  assert.deepEqual(apiCalls.sort(), ['/stats/footprint', '/stats/overview', '/stats/trend?days=365'].sort());
  assert.equal(p.data.overviewError, null);
  assert.equal(p.data.totalOverview.trackCount, 32);
  assert.equal(p.data.loading, false, '重试结束后要收掉 loading');
});

test('H7 游客态：不发请求、不留失败提示', async () => {
  resetEnv();
  loggedIn = false;
  const p = makePage();
  await p.loadOverview();

  assert.deepEqual(apiCalls, []);
  assert.equal(p.data.heatError, null);
  assert.equal(p.data.overviewError, null);
  assert.equal(p.data.notLoggedIn, true);
});

test('H8 接口全挂时屏上仍是缓存值，但失败要如实标出来', async () => {
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
  assert.ok(p.data.overviewError && p.data.heatError, '但失败要如实标出来');
});

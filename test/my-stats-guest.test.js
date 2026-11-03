/**
 * 「我的」页数据统计卡：未登录态的呈现（2026-11-03 用户红框指定范围）
 * - 游客：保留卡头「数据统计」，三格网格不渲染，改显示一句引导「登录后查看运动统计」；
 * - 游客点整卡：走登录闸门，不跳统计页（跳过去也会被闸门拦住，等于一次死点）；
 * - 登录后：引导句消失、三格回来，点卡进统计页。
 * 运行：node --test test/my-stats-guest.test.js；桩：wx / Page / getApp 就地 stub。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let appLoggedIn = false;
let loginCalls = 0;
const navs = [];

global.wx = {
  getStorageSync: () => '',
  setStorageSync: () => {},
  navigateTo: (o) => navs.push(o && o.url),
  showToast: () => {},
  stopPullDownRefresh: () => {},
};
global.getApp = () => ({
  globalData: { loggedIn: appLoggedIn, user: null, homeDirty: false },
  hasSession: () => appLoggedIn,
  login: async () => {},
});

const fakeApi = { get: async () => ({}), post: async () => ({}), put: async () => ({}), del: async () => ({}) };
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };

const loginGatePath = require.resolve('../miniprogram/utils/login-gate.js');
require.cache[loginGatePath] = {
  id: loginGatePath, filename: loginGatePath, loaded: true,
  exports: { ensureLogin: async () => { loginCalls += 1; return false; } },
  children: [], paths: [],
};

let pageDef = null;
global.Page = (d) => { pageDef = d; };
require('../miniprogram/pages/my/my.js');
assert.ok(pageDef, 'my.js 应通过 Page() 交出页面对象');

function boot(loggedIn) {
  appLoggedIn = loggedIn;
  const p = Object.assign({}, pageDef);
  p.data = JSON.parse(JSON.stringify(pageDef.data));
  p.setData = (patch) => Object.assign(p.data, patch || {});
  return p;
}

test('GS1 未登录：卡头保留、引导句存在，三格网格包在登录分支里', () => {
  const w = read('miniprogram/pages/my/my.wxml');
  assert.ok(w.includes('登录后查看运动统计'), '游客要看到这句而不是三个空格子');
  // 三格网格必须只在 loggedIn 时渲染，引导句是它的 wx:else（WXML 要求 else 紧邻 if）
  assert.match(w, /<view class="stats-grid" wx:if="\{\{loggedIn\}\}">/);
  assert.match(w, /<view class="stats-guide" wx:else>登录后查看运动统计<\/view>/);
});

test('GS2 游客点整卡：触发登录闸门，不跳统计页', async () => {
  navs.length = 0;
  loginCalls = 0;
  const p = boot(false);
  p.data.loggedIn = false;
  await p.onTapStats();
  assert.equal(loginCalls, 1);
  assert.deepEqual(navs, []);
});

test('GS3 登录后点整卡：进统计页，不触发登录', async () => {
  navs.length = 0;
  loginCalls = 0;
  const p = boot(true);
  p.data.loggedIn = true; // 真实页面由 refreshUser 落这个标记，这里直接摆到位
  await p.onTapStats();
  assert.equal(loginCalls, 0);
  assert.deepEqual(navs, ['/pages/stats/stats']);
});

/**
 * 「我的」页头像会员徽标（2026-11-04）：
 * - 徽标只在 loggedIn && isMember 时渲染，贴在头像右下角；
 * - isMember 只认 /member/entitlements 的 memberActive（付费会员订单口径，不含免广告卡）；
 * - 游客/接口失败一律不显示，不编造会员身份。
 * 运行：node --test test/my-member-badge.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let apiCalls = [];
let entitlementsRespond = () => Promise.resolve({ memberActive: true });
let loggedIn = true;
let session = true;

const fakeApi = {
  get(p) {
    apiCalls.push(p);
    if (p === '/member/entitlements') return entitlementsRespond(p);
    if (p === '/users/me') return Promise.resolve({ id: 'u1', nickname: '甲', createdAt: new Date().toISOString(), settings: {} });
    if (p === '/points/summary') return Promise.resolve({ balance: 10, signin: { todaySigned: true, streakDay: 1, nextReward: 1 } });
    if (p === '/notifications/summary') return Promise.resolve({ unreadCount: 0 });
    return Promise.resolve({});
  },
  post: async () => ({}),
  put: async () => ({}),
  del: async () => ({}),
};
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };

const loginGatePath = require.resolve('../miniprogram/utils/login-gate.js');
require.cache[loginGatePath] = {
  id: loginGatePath, filename: loginGatePath, loaded: true,
  exports: { ensureLogin: async () => true }, children: [], paths: [],
};

global.wx = {
  getStorageSync: () => '',
  setStorageSync: () => {},
  showToast: () => {},
  stopPullDownRefresh: () => {},
};
const appStub = {
  globalData: { loggedIn: true, user: null },
  hasSession: () => session,
  login: async () => { loggedIn = true; },
  maybeShowProfileGuide: () => {},
};
global.getApp = () => appStub;

let pageDef = null;
global.Page = (d) => { pageDef = d; };
require('../miniprogram/pages/my/my.js');
assert.ok(pageDef, 'my.js 应通过 Page() 交出页面对象');

function boot() {
  const p = Object.assign({}, pageDef);
  p.data = JSON.parse(JSON.stringify(pageDef.data));
  p.setData = (patch) => Object.assign(p.data, patch || {});
  return p;
}
const tick = () => new Promise((r) => setImmediate(r));

function reset(opts) {
  apiCalls = [];
  loggedIn = !(opts && opts.guest);
  session = !(opts && opts.guest);
  appStub.globalData.loggedIn = loggedIn;
  entitlementsRespond = (opts && opts.entitlements) || (() => Promise.resolve({ memberActive: true }));
}

test('MB-1 结构：徽标绑 loggedIn && isMember，贴在头像右下角', () => {
  const w = read('miniprogram/pages/my/my.wxml');
  assert.match(w, /class="user-avatar-wrap"[\s\S]*member-badge\.png/);
  assert.ok(w.includes('wx:if="{{loggedIn && isMember}}"'));
  assert.ok(fs.existsSync(path.join(root, 'miniprogram/assets/icons/member-badge.png')));
  const css = read('miniprogram/pages/my/my.wxss');
  assert.match(css, /\.avatar-member-badge\s*\{[^}]*position:\s*absolute/, '徽标要绝对定位在头像角上');
  assert.match(css, /\.avatar-member-badge\s*\{[^}]*bottom:\s*-8rpx/, '徽标下缘挂出头像 8rpx，不再压到下方内容');
});

test('MB-2 登录且会员生效：isMember = true', async () => {
  reset();
  const p = boot();
  await p.refreshUser();
  await tick();
  assert.ok(apiCalls.includes('/member/entitlements'));
  assert.equal(p.data.isMember, true);
});

test('MB-3 非会员 / 接口失败：不显示徽标', async () => {
  reset({ entitlements: () => Promise.resolve({ memberActive: false }) });
  let p = boot();
  await p.refreshUser();
  await tick();
  assert.equal(p.data.isMember, false);

  reset({ entitlements: () => Promise.reject(new Error('down')) });
  p = boot();
  await p.refreshUser();
  await tick();
  assert.equal(p.data.isMember, false, '失败按非会员降级，不编造');
});

test('MB-4 游客：不拉权益接口，isMember 为 false', async () => {
  reset({ guest: true });
  const p = boot();
  await p.refreshUser();
  await tick();
  assert.ok(!apiCalls.includes('/member/entitlements'));
  assert.equal(p.data.isMember, false);
});

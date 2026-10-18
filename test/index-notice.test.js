/**
 * 首页顶部通知条：登录用户有未读才显示（红点），游客显示最新已发布（无红点）；
 * summary 并入 60s 节流批次；notificationDirty（刚读完通知）只补拉 summary。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const apiCalls = [];
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
global.wx = {
  getStorageSync: (k) => (storage.has(k) ? storage.get(k) : ''),
  setStorageSync: (k, v) => storage.set(k, v),
  showToast: () => {},
  nextTick: (cb) => cb(),
  stopPullDownRefresh: () => {},
  navigateTo: () => {},
};
let pageDef = null;
global.Page = (def) => { pageDef = def; };

let session = true;
let loggedIn = true;
const appStub = {
  globalData: { loggedIn: true, homeDirty: false, notificationDirty: false, userInfo: null },
  hasSession: () => session,
  login: async () => { loggedIn = true; appStub.globalData.loggedIn = true; },
  maybeShowProfileGuide: () => {},
};
global.getApp = () => appStub;

require('../miniprogram/pages/index/index.js');
assert.ok(pageDef, 'index.js 应通过 Page() 交出页面对象');

const flush = () => new Promise((r) => setTimeout(r, 0));

function makePage() {
  const p = Object.assign({}, pageDef);
  p.data = JSON.parse(JSON.stringify(pageDef.data));
  p.setData = (patch) => Object.assign(p.data, patch);
  return p;
}

function resetEnv() {
  apiCalls.length = 0;
  storage.clear();
  session = true;
  loggedIn = true;
  appStub.globalData.loggedIn = true;
  appStub.globalData.homeDirty = false;
  appStub.globalData.notificationDirty = false;
  respond = (p) => {
    if (p === '/notifications/summary') {
      return Promise.resolve({ item: { id: 'n1', title: '系统维护通知' }, unreadCount: 1 });
    }
    return Promise.resolve({});
  };
}

test('IN1 登录有未读：通知条出最新未读并带红点', async () => {
  resetEnv();
  const p = makePage();
  p.onShow();
  await flush();

  assert.ok(apiCalls.includes('/notifications/summary'), '首页批次要拉通知摘要');
  assert.deepEqual(p.data.notice, { id: 'n1', title: '系统维护通知' });
  assert.equal(p.data.noticeDot, true);
});

test('IN2 没有未读：item=null → 不渲染通知条', async () => {
  resetEnv();
  respond = (p) =>
    p === '/notifications/summary'
      ? Promise.resolve({ item: null, unreadCount: 0 })
      : Promise.resolve({});
  const p = makePage();
  p.onShow();
  await flush();
  assert.equal(p.data.notice, null);
});

test('IN3 游客：显示最新已发布，但不显示红点', async () => {
  resetEnv();
  session = false;
  loggedIn = false;
  appStub.globalData.loggedIn = false;
  const p = makePage();
  p.onShow();
  await flush();
  assert.deepEqual(p.data.notice, { id: 'n1', title: '系统维护通知' });
  assert.equal(p.data.noticeDot, false, '游客没有已读概念，不画红点');
});

test('IN4 60s 内切回不重拉；notificationDirty 只补拉 summary', async () => {
  resetEnv();
  const p = makePage();
  p.onShow();
  await flush();

  apiCalls.length = 0;
  p.onShow();
  await flush();
  assert.deepEqual(apiCalls, [], 'TTL 内不发请求');

  appStub.globalData.notificationDirty = true;
  p.onShow();
  await flush();
  assert.deepEqual(apiCalls, ['/notifications/summary'], '只补通知摘要，不重拉整屏');
  assert.equal(appStub.globalData.notificationDirty, false, '消费后清标记');
});

test('IN5 下拉刷新：五块一起重拉（含通知摘要）', async () => {
  resetEnv();
  const p = makePage();
  await p.onPullDownRefresh();
  assert.ok(apiCalls.includes('/notifications/summary'));
});

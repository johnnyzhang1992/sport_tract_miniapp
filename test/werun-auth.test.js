/**
 * 微信运动授权引导（2026-11-05）：
 * 1) getWeRunAuthState 三态映射（隐私未同意 / 已授权 / 曾拒绝 / 从未问过）；
 * 2) 进入页面即检查：已授权 → 静默同步；未授权 → 弹窗引导（每天最多一次）；
 * 3) 曾拒绝 → 去设置页，设置里打开后才同步；
 * 4) 顶部提示条点击按状态分流。
 * 运行：node --test test/werun-auth.test.js；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('WA1 结构：页面引入授权检查，wxml 有提示条与点击绑定', () => {
  const js = read('miniprogram/pages/werun-board/werun-board.js');
  assert.ok(js.includes('getWeRunAuthState'), '要查授权状态');
  assert.ok(js.includes('checkWeRunAuth'), '进入页面要检查');
  assert.ok(/onShow\(\)[\s\S]{0,400}checkWeRunAuth\(\)/.test(js), 'onShow 里触发检查');
  const wxml = read('miniprogram/pages/werun-board/werun-board.wxml');
  assert.ok(wxml.includes('bindtap="onTapAuthBanner"'), '提示条可点');
  assert.ok(wxml.includes("weRunAuth !== 'granted'"), '已授权不显示提示条');
});

/* --------------------------------- 环境桩 --------------------------------- */

let authSetting = {};
let privacyNeed = false;
let syncCalls = [];
let syncResult = { ok: true, syncedDays: 1, days: [] };
let modals = [];
let toasts = [];
let storage = {};
let openSettingResult = true;
let apiGets = [];

global.wx = {
  getPrivacySetting: (o) => o.success({ needAuthorization: privacyNeed }),
  requirePrivacyAuthorize: (o) => o.success({}),
  getSetting: (o) => o.success({ authSetting }),
  authorize: (o) => { authSetting = { ...authSetting, [o.scope]: true }; o.success({}); },
  openSetting: (o) => {
    if (openSettingResult) authSetting = { ...authSetting, 'scope.werun': true };
    o.success({ authSetting });
  },
  login: (o) => o.success({ code: 'c' }),
  getWeRunData: (o) => o.success({ encryptedData: 'e', iv: 'i' }),
  showModal: (o) => { modals.push({ title: o.title, content: o.content, confirmText: o.confirmText }); if (o.success) o.success({ confirm: !!o.__confirm }); },
  showToast: (o) => toasts.push(o && o.title),
  getStorageSync: (k) => storage[k] || '',
  setStorageSync: (k, v) => { storage[k] = v; },
  stopPullDownRefresh: () => {},
  navigateTo: () => {},
};

// werun util 走真实实现（它只依赖 wx + api），api 用桩
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = {
  id: apiPath, filename: apiPath, loaded: true,
  exports: {
    get: (p) => { apiGets.push(p); return Promise.resolve({ players: 0, top: [], me: null, window: null, prevPeriodKey: null, nextPeriodKey: null, provinces: [] }); },
    post: (p, body) => { syncCalls.push({ p, body }); return Promise.resolve(syncResult); },
  },
  children: [], paths: [],
};

let pageDef = null;
global.Page = (d) => { pageDef = d; };
global.getApp = () => ({
  globalData: { loggedIn: true, api: require.cache[apiPath].exports },
  hasSession: () => true,
  login: () => Promise.resolve(),
});
require('../miniprogram/pages/werun-board/werun-board.js');
assert.ok(pageDef, 'werun-board.js 应通过 Page() 交出页面对象');

const tick = () => new Promise((r) => setImmediate(r));
const flush = () => new Promise((r) => setTimeout(r, 10));

function boot() {
  const p = Object.assign({}, pageDef);
  p.data = JSON.parse(JSON.stringify(pageDef.data));
  p.setData = (patch) => Object.assign(p.data, patch);
  return p;
}

function reset(over = {}) {
  authSetting = over.authSetting ?? {};
  privacyNeed = over.privacyNeed ?? false;
  syncCalls = []; modals = []; toasts = []; storage = {}; apiGets = [];
  openSettingResult = over.openSettingResult ?? true;
  syncResult = over.syncResult ?? { ok: true, syncedDays: 1, days: [] };
}

/* --------------------------------- 用例 --------------------------------- */

test('WA2 已授权：进入页面不弹窗，静默同步一趟', async () => {
  reset({ authSetting: { 'scope.werun': true } });
  const p = boot();
  p.onShow();
  await flush();
  assert.equal(p.data.weRunAuth, 'granted');
  assert.equal(modals.length, 0, '已授权不弹窗');
  assert.equal(syncCalls.length, 1, '要静默同步一次');
  assert.ok(apiGets.some((u) => u.includes('/werun/board')), '同步后刷新榜单');
});

test('WA3 从未授权：弹一次引导；同意后拉起授权并同步', async () => {
  reset();
  const p = boot();
  p.onShow();
  await flush();
  assert.equal(p.data.weRunAuth, 'unasked');
  assert.equal(modals.length, 1);
  assert.match(modals[0].title, /开启微信运动/);
  assert.equal(modals[0].confirmText, '去开启');

  // 用户点「去开启」
  const orig = global.wx.showModal;
  global.wx.showModal = (o) => { modals.push({ title: o.title }); o.success({ confirm: true }); };
  p.promptWeRunAuth('unasked');
  global.wx.showModal = orig;
  await flush();
  assert.equal(syncCalls.length, 1, '授权后要同步');
  assert.ok(toasts.some((t) => /已同步/.test(t)));
});

test('WA4 曾拒绝：引导去设置页；设置里打开后才同步', async () => {
  reset({ authSetting: { 'scope.werun': false } });
  const p = boot();
  p.onShow();
  await flush();
  assert.equal(p.data.weRunAuth, 'denied');
  assert.equal(modals[0].confirmText, '去设置', '曾拒绝时文案是「去设置」');

  await p.openSettingAndSync();
  await flush();
  assert.equal(p.data.weRunAuth, 'granted');
  assert.equal(syncCalls.length, 1, '设置页打开后同步');
});

test('WA5 设置页里没打开授权：给提示、不同步', async () => {
  reset({ authSetting: { 'scope.werun': false }, openSettingResult: false });
  const p = boot();
  p.onShow();
  await flush();
  await p.openSettingAndSync();
  assert.equal(syncCalls.length, 0, '没授权就不该同步');
  assert.ok(toasts.some((t) => /未开启/.test(t)));
});

test('WA6 每天最多弹一次：当天再进页面只显示提示条不弹窗', async () => {
  reset();
  const p1 = boot();
  p1.onShow();
  await flush();
  assert.equal(modals.length, 1);

  const p2 = boot();
  p2.onShow();
  await flush();
  assert.equal(modals.length, 1, '同一天不应再弹');
  assert.equal(p2.data.weRunAuth, 'unasked', '提示条仍显示');
});

test('WA7 微信运动未开启（getWeRunData 报 no data）：弹窗指引去微信里开启', async () => {
  reset({ authSetting: { 'scope.werun': true } });
  global.wx.getWeRunData = (o) => o.fail({ errMsg: 'getWeRunData:fail no data' });
  const p = boot();
  p.onShow();
  await flush();
  await flush();
  const disabled = modals.find((m) => /微信运动未开启/.test(m.title || ''));
  assert.ok(disabled, '要提示去微信里开启微信运动');
  global.wx.getWeRunData = (o) => o.success({ encryptedData: 'e', iv: 'i' });
});

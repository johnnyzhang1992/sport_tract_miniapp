/**
 * 写操作前置登录闸门（utils/login-gate.js）单测。
 * 足迹两页共用同一份弹窗文案，所以行为收在一个模块里测——页面侧只测「有没有接上」（见
 * footprints-page.test.js / footprint-list-page.test.js 的登录态用例）。
 * 运行：npm test；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { ensureLogin } = require('../miniprogram/utils/login-gate.js');

/* ---------------------------------- 环境桩 ---------------------------------- */

const modals = [];
const toasts = [];
let loginCalls = 0;
let loginFails = null;
const appStub = {
  globalData: { loggedIn: true },
  login() {
    loginCalls++;
    if (loginFails) return Promise.reject(loginFails);
    appStub.globalData.loggedIn = true;
    return Promise.resolve({});
  },
};

global.getApp = () => appStub;
global.wx = {
  showModal: (o) => modals.push(o),
  showToast: (o) => toasts.push(o && o.title),
};

function reset() {
  modals.length = 0;
  toasts.length = 0;
  loginCalls = 0;
  loginFails = null;
  appStub.globalData.loggedIn = true;
}

/* ---------------------------------- 用例 ---------------------------------- */

test('G1 已登录不弹窗直接放行：一个弹窗都不开，同步 resolve true', async () => {
  reset();
  const p = ensureLogin();
  assert.equal(modals.length, 0, '已登录不该再问一次');
  assert.equal(await p, true);
  assert.equal(loginCalls, 0);
});

test('G2 游客取消：不登录、不开表单，resolve false', async () => {
  reset();
  appStub.globalData.loggedIn = false;
  const p = ensureLogin();
  assert.equal(modals.length, 1, '游客要先弹窗征得同意（不静默建档）');
  assert.equal(modals[0].confirmText, '登录');
  assert.equal(modals[0].cancelText, '暂不');
  assert.equal(modals[0].content, '登录后才能记录你的足迹。');
  modals[0].success({ confirm: false });
  assert.equal(await p, false);
  assert.equal(loginCalls, 0, '点了「暂不」不该去登录');
});

test('G3 游客确认：静默登录后 resolve true', async () => {
  reset();
  appStub.globalData.loggedIn = false;
  const p = ensureLogin();
  modals[0].success({ confirm: true });
  assert.equal(await p, true);
  assert.equal(loginCalls, 1);
  assert.deepEqual(toasts, [], '登录成功不弹 toast（调用方接着做正事）');
});

test('G4 登录失败：toast 带具体原因、resolve false（不得当成功放行）', async () => {
  reset();
  appStub.globalData.loggedIn = false;
  loginFails = new Error('wx.login:fail 网络不可用');
  const p = ensureLogin();
  modals[0].success({ confirm: true });
  assert.equal(await p, false);
  assert.deepEqual(toasts, ['wx.login:fail 网络不可用'], '失败要给服务端/微信给的原话，不是「登录失败」四个字');
});

test('G5 登录失败但错误没带信息 + 弹窗自身 fail：兜底文案与安全放行', async () => {
  reset();
  appStub.globalData.loggedIn = false;
  loginFails = {};
  let p = ensureLogin();
  modals[0].success({ confirm: true });
  assert.equal(await p, false);
  assert.deepEqual(toasts, ['登录失败，请重试'], '错误对象没 message 时才回落兜底文案');

  reset();
  appStub.globalData.loggedIn = false;
  p = ensureLogin();
  modals[0].fail({ errMsg: 'showModal:fail' });
  assert.equal(await p, false, '弹窗都开不出来 → 视为未获授权，不能放行写操作');
  assert.equal(loginCalls, 0);
});

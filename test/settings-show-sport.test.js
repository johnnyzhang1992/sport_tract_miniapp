/**
 * 设置页「展示运动数据」开关（2026-11-04）：
 * - 默认开；关闭时弹提示半屏（说明榜单仍保留名次/距离，资料卡八项隐藏）；
 * - 开关只改本地态，仍需点「保存」落库；重新打开收起提示。
 * 运行：node --test test/settings-show-sport.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let apiGets = [];
let apiPuts = [];
let meSettings = {};
const fakeApi = {
  get(p) {
    apiGets.push(p);
    if (p === '/users/me') return Promise.resolve({ settings: meSettings });
    if (p === '/member/entitlements') return Promise.resolve({ adFreeUntil: 0 });
    return Promise.resolve({});
  },
  put(p, body) {
    apiPuts.push({ p, body });
    return Promise.resolve({ settings: body.settings });
  },
};
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };

const storagePath = require.resolve('../miniprogram/services/storage.js');
require.cache[storagePath] = {
  id: storagePath, filename: storagePath, loaded: true,
  exports: { getToken: () => ({ accessToken: 't' }) }, children: [], paths: [],
};
const adFreePath = require.resolve('../miniprogram/utils/ad-free.js');
require.cache[adFreePath] = {
  id: adFreePath, filename: adFreePath, loaded: true,
  exports: { setAdFreeUntil: () => {} }, children: [], paths: [],
};

global.wx = {
  showToast: () => {},
  showModal: () => {},
  navigateBack: () => {},
  switchTab: () => {},
  getStorageSync: () => '',
  setStorageSync: () => {},
};
let pageDef = null;
global.Page = (d) => { pageDef = d; };
global.getApp = () => ({ globalData: { userInfo: null }, logout: () => {} });
require('../miniprogram/pages/settings/settings.js');
assert.ok(pageDef, 'settings.js 应通过 Page() 交出页面对象');

function boot() {
  const p = Object.assign({}, pageDef);
  p.data = JSON.parse(JSON.stringify(pageDef.data));
  p.setData = (patch) => {
    for (const [k, v] of Object.entries(patch)) {
      const parts = k.split('.');
      let o = p.data;
      for (let i = 0; i < parts.length - 1; i += 1) o = o[parts[i]];
      o[parts[parts.length - 1]] = v;
    }
  };
  return p;
}

test('SSP1 结构：开关 + 提示半屏文案齐全，默认打开', () => {
  const w = read('miniprogram/pages/settings/settings.wxml');
  assert.ok(w.includes('展示运动数据'));
  assert.match(w, /<t-switch value="\{\{settings\.showSportData\}\}" bind:change="onShowSportDataChange"/);
  assert.ok(w.includes('已关闭展示运动数据'));
  assert.ok(w.includes('保存设置后生效'));
  assert.ok(w.includes('运动榜仍保留你的名次和距离'));
  assert.ok(w.includes('知道了'));
  assert.equal(pageDef.data.settings.showSportData, true);
});

test('SSP2 老用户没有该字段时按默认 true 处理', async () => {
  meSettings = { highAccuracy: true, showBodyData: true, kmAnnounce: true };
  const p = boot();
  await p.loadSettings();
  assert.equal(p.data.settings.showSportData, true);
});

test('SSP3 关闭弹提示半屏、重新打开收起，关闭按钮生效', () => {
  const p = boot();
  p.onShowSportDataChange({ detail: { value: false } });
  assert.equal(p.data.settings.showSportData, false);
  assert.equal(p.data.sportSheetVisible, true);
  p.onShowSportDataChange({ detail: { value: true } });
  assert.equal(p.data.settings.showSportData, true);
  assert.equal(p.data.sportSheetVisible, false);

  p.onShowSportDataChange({ detail: { value: false } });
  p.closeSportSheet();
  assert.equal(p.data.sportSheetVisible, false);
  assert.equal(p.data.settings.showSportData, false, '关提示不改变开关状态');
});

test('SSP4 保存把 showSportData 一并提交', async () => {
  apiPuts = [];
  const p = boot();
  p.data.settings.showSportData = false;
  await p.save();
  assert.equal(apiPuts.length, 1);
  assert.equal(apiPuts[0].p, '/users/me');
  assert.equal(apiPuts[0].body.settings.showSportData, false);
});

test('SSP5 同步微信步数开关：默认开、老用户缺字段按开、保存一并提交', async () => {
  const w = read('miniprogram/pages/settings/settings.wxml');
  assert.match(w, /<t-switch value="\{\{settings\.dailyStepSync\}\}" bind:change="onDailyStepSyncChange"/);
  assert.ok(w.includes('开启后每天进入小程序自动同步'));
  assert.ok(!w.includes('关闭后只在活动期间同步'), '说明文案不再解释关闭后的行为');
  assert.equal(pageDef.data.settings.dailyStepSync, true);

  meSettings = { highAccuracy: true };
  const p = boot();
  await p.loadSettings();
  assert.equal(p.data.settings.dailyStepSync, true, '老用户没有该字段按开启处理');

  apiPuts = [];
  p.onDailyStepSyncChange({ detail: { value: false } });
  assert.equal(p.data.settings.dailyStepSync, false);
  await p.save();
  assert.equal(apiPuts[0].body.settings.dailyStepSync, false);
});

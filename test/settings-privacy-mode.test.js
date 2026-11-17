/**
 * 设置页「隐私模式」开关（2026-11-09，合并原「展示运动数据」开关）：
 * - 隐私模式默认关；开关只改本地态，仍需点「保存」落库；
 * - 展示运动数据开关已移除（口径并入隐私模式），但 showSportData 字段仍随 settings 往返，老用户已关的不丢；
 * - 同页所有 t-switch 统一 size="small"。
 * 运行：node --test test/settings-privacy-mode.test.js
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
// loadSettings 会先查会话（游客态不请求 /users/me）
const appGlobalData = { userInfo: null, loggedIn: true };
global.getApp = () => ({
  globalData: appGlobalData,
  hasSession: () => true,
  login: () => Promise.resolve(),
  logout: () => {},
});
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

test('SPM1 结构：隐私模式开关 + 合并口径文案齐全；展示运动数据开关与提示半屏已移除', () => {
  const w = read('miniprogram/pages/settings/settings.wxml');
  assert.ok(w.includes('隐私模式'));
  assert.match(w, /<t-switch value="\{\{settings\.privacyMode\}\}" bind:change="onPrivacyModeChange" size="small"/);
  assert.match(w, /运动榜与步数榜不展示你的昵称和头像/, '说明文案覆盖榜单匿名');
  assert.match(w, /资料卡不再展示你的运动数据/, '说明文案覆盖资料卡（原展示运动数据开关的职责）');
  assert.equal(w.includes('展示运动数据'), false, '旧开关已移除');
  assert.equal(w.includes('sportSheetVisible'), false, '提示半屏已移除');
  assert.equal(pageDef.data.settings.privacyMode, false, '默认关闭');

  // 同页所有 t-switch 统一 size="small"
  const switches = w.match(/<t-switch\b[^>]*>/g) || [];
  assert.ok(switches.length > 0);
  for (const tag of switches) assert.match(tag, /size="small"/, `开关应统一 small：${tag}`);
});

test('SPM2 老用户没有 privacyMode 字段时按默认 false 处理', async () => {
  meSettings = { highAccuracy: true, showBodyData: true, kmAnnounce: true };
  const p = boot();
  await p.loadSettings();
  assert.equal(p.data.settings.privacyMode, false);
});

test('SPM3 开关只改本地态（onPrivacyModeChange），保存随 settings 提交', async () => {
  apiPuts = [];
  const p = boot();
  p.onPrivacyModeChange({ detail: { value: true } });
  assert.equal(p.data.settings.privacyMode, true);
  await p.save();
  assert.equal(apiPuts.length, 1);
  assert.equal(apiPuts[0].p, '/users/me');
  assert.equal(apiPuts[0].body.settings.privacyMode, true);
});

test('SPM4 showSportData 字段随 settings 往返：老用户已关的值保存时不丢', async () => {
  meSettings = { showSportData: false };
  apiPuts = [];
  const p = boot();
  await p.loadSettings();
  assert.equal(p.data.settings.showSportData, false, 'GET 下发的旧值保留在本地态');
  p.onPrivacyModeChange({ detail: { value: true } });
  await p.save();
  assert.equal(apiPuts[0].body.settings.showSportData, false, '往返不把老用户的关闭值重置为 true');
});

/* 游客态（2026-11-17）：/users/me 需要登录，未登录不该请求；
   保存按钮与需登录的设置项隐藏，纯前端的运动类型设置保留。 */
test('SPM20 游客态：不请求 /users/me，标记 notLoggedIn，保存被拦截', async () => {
  apiGets = [];
  apiPuts = [];
  appGlobalData.loggedIn = false;
  try {
    const p = boot();
    await p.loadSettings();
    assert.deepEqual(apiGets, [], '游客态不该请求任何接口');
    assert.equal(p.data.notLoggedIn, true);
    assert.equal(p.data.loggedIn, false);

    await p.save();
    assert.deepEqual(apiPuts, [], '游客态保存不该发 PUT');
  } finally {
    appGlobalData.loggedIn = true;
  }
});

test('SPM21 游客态 WXML：需登录卡片与保存按钮被 !notLoggedIn 包住，运动类型卡片不受影响', () => {
  const w = read('miniprogram/pages/settings/settings.wxml');
  assert.ok(w.includes('<guest-hint'), '应使用 guest-hint 组件');
  assert.ok(w.includes('wx:if="{{!notLoggedIn}}"'), '需登录区块应有 notLoggedIn 守卫');
  // 运动类型卡片在守卫之前（游客可用）
  const typeIdx = w.indexOf('运动类型显示');
  const guardIdx = w.indexOf('wx:if="{{!notLoggedIn}}"');
  assert.ok(typeIdx > 0 && typeIdx < guardIdx, '运动类型设置应在游客可用区（守卫之前）');
  // 保存按钮受守卫
  const saveIdx = w.indexOf('>保存</t-button>');
  const saveTag = w.slice(w.lastIndexOf('<t-button', saveIdx), saveIdx);
  assert.ok(saveTag.includes('wx:if="{{!notLoggedIn}}"'), '保存按钮游客态必须隐藏');
});

test('SPM22 登录后恢复正常：拉一次 /users/me 并清掉 notLoggedIn', async () => {
  apiGets = [];
  appGlobalData.loggedIn = true;
  const p = boot();
  p.data.notLoggedIn = true;
  await p.loadSettings();
  assert.deepEqual(apiGets, ['/users/me']);
  assert.equal(p.data.notLoggedIn, false);
  assert.equal(p.data.loggedIn, true);
});

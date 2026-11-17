/**
 * 账号与安全页（2026-11-17）：pages/account-security
 *
 * - 两张卡：退出登录（从设置页移过来）、注销账号
 * - 注销三层确认：卡片说明 → 弹窗输入昵称 → 服务端校验
 * - 昵称宽松匹配（忽略首尾空格/大小写）；空昵称用「注销」确认
 * 运行：node --test test/account-security.test.js
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../miniprogram');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let meResponse = { nickname: '小明' };
let postCalls = [];
let postShouldFail = null;

const fakeApi = {
  get(p) {
    if (p === '/users/me') return Promise.resolve(meResponse);
    return Promise.resolve({});
  },
  post(p, body) {
    postCalls.push({ p, body });
    if (postShouldFail) return Promise.reject(postShouldFail);
    return Promise.resolve({ deleted: true });
  },
};
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };

let modalRes = { confirm: false };
const toasts = [];
const navigations = [];
global.wx = {
  showModal: (o) => { if (o.success) o.success(modalRes); },
  showToast: (o) => toasts.push(o.title),
  switchTab: (o) => navigations.push(o.url),
  navigateTo: (o) => navigations.push(o.url),
};
let loggedOut = 0;
let appLoggedIn = true;
const appGlobalData = { loggedIn: true };
global.getApp = () => ({
  globalData: appGlobalData,
  hasSession: () => appLoggedIn,
  login: () => { appLoggedIn = true; appGlobalData.loggedIn = true; return Promise.resolve(); },
  logout: () => { loggedOut += 1; },
});

let pageDef = null;
global.Page = (d) => { pageDef = d; };
require('../miniprogram/pages/account-security/account-security.js');

/** 页面实例：raw setData（不跑回调），因为 recheck 依赖回调链 */
function boot() {
  const p = Object.assign({}, pageDef);
  p.data = JSON.parse(JSON.stringify(pageDef.data));
  p.setData = (patch, cb) => {
    Object.assign(p.data, patch);
    if (cb) cb();
  };
  return p;
}

after(() => {
  delete global.getApp;
});

/* ── 结构与入口 ───────────────────────────────── */

test('AS1 页面结构：两张卡（退出登录 / 注销账号）', () => {
  const w = read('pages/account-security/account-security.wxml');
  assert.ok(w.includes('退出登录'), '应有退出登录');
  assert.ok(w.includes('注销账号'), '应有注销账号');
});

test('AS2b 布局：说明在上、按钮在下，右侧无箭头（改版 2026-11-17）', () => {
  const w = read('pages/account-security/account-security.wxml');
  // 两张卡都用「标题 → 说明 → 按钮」的纵向结构
  assert.ok(w.includes('class="action-title"') && w.includes('class="action-desc"') && w.includes('class="action-btn"'));
  assert.ok(w.includes('class="danger-title"') && w.includes('class="danger-desc"') && w.includes('class="danger-btn"'));
  // 说明必须排在按钮之前
  assert.ok(w.indexOf('danger-desc') < w.indexOf('danger-btn'), '注销说明应在按钮上方');
  assert.ok(w.indexOf('action-desc') < w.indexOf('action-btn'), '退出说明应在按钮上方');
  // 不再有右箭头 / 整行可点的列表样式
  assert.ok(!w.includes('row-arrow'), '不该再有右箭头');
  assert.ok(!w.includes('class="row"'), '不该再用整行可点样式');
});

test('AS2 注销卡片写清后果：永久删除 + 无法恢复', () => {
  const w = read('pages/account-security/account-security.wxml');
  assert.match(w, /永久删除/, '必须说明会永久删除');
  assert.match(w, /无法恢复/, '必须说明无法恢复');
  // 明确列出会被清掉的数据，避免用户误解只删一部分
  for (const kw of ['运动轨迹', '运动计划', '积分', '足迹', '体重']) {
    assert.ok(w.includes(kw), `说明里应提到「${kw}」`);
  }
  assert.match(w, /谨慎操作/, '应有谨慎提示');
});

test('AS3 入口在「我的」页数据导出下方', () => {
  const w = read('pages/my/my.wxml');
  const exportIdx = w.indexOf('数据导出');
  const secIdx = w.indexOf('账号与安全');
  assert.ok(exportIdx > 0 && secIdx > exportIdx, '账号与安全应排在数据导出之后');
});

test('AS4 设置页不再有退出登录（已迁走）', () => {
  const w = read('pages/settings/settings.wxml');
  const js = read('pages/settings/settings.js');
  assert.ok(!w.includes('退出登录'), '设置页 WXML 不该再有退出登录');
  assert.ok(!/logout\s*\(/.test(js), '设置页 JS 不该再有 logout 方法');
});

test('AS5 app.json 已注册页面', () => {
  const app = JSON.parse(read('app.json'));
  assert.ok(app.pages.includes('pages/account-security/account-security'));
});

/* ── 退出登录 ─────────────────────────────────── */

test('AS6 退出登录：取消则什么都不做；确认则清登录态并回我的页', async () => {
  modalRes = { confirm: false };
  let p = boot();
  const before = loggedOut;
  p.logout();
  assert.equal(loggedOut, before, '取消不该退出');

  modalRes = { confirm: true };
  p = boot();
  p.logout();
  assert.equal(loggedOut, before + 1, '确认应调用 logout');
  await new Promise((r) => setTimeout(r, 700));
  assert.ok(navigations.includes('/pages/my/my'), '应回到我的页');
});

/* ── 注销：昵称校验 ───────────────────────────── */

test('AS7 打开弹窗：清空输入与错误态', () => {
  const p = boot();
  p.data.confirmInput = '乱写的';
  p.data.confirmError = '旧错误';
  p.openDeactivate();
  assert.equal(p.data.confirmVisible, true);
  assert.equal(p.data.confirmInput, '');
  assert.equal(p.data.confirmError, '');
});

test('AS8 输入匹配才允许提交（宽松：首尾空格 + 大小写）', () => {
  const p = boot();
  p.data.nickname = 'XiaoMing';
  p.data.confirmInput = '  xiaoming  ';
  p.recheck();
  assert.equal(p.data.confirmOk, true, '首尾空格与大小写应忽略');

  p.data.confirmInput = 'xiaomin';
  p.recheck();
  assert.equal(p.data.confirmOk, false, '拼错不该通过');
});

test('AS8b onConfirmInput 用事件值即时判定（曾因依赖 setData 回调读到旧值而不生效）', () => {
  const p = boot();
  p.data.nickname = '小小梦工场';
  // 模拟输入事件：此时 data.confirmInput 还是空串，必须用 e.detail.value 来判定
  p.onConfirmInput({ detail: { value: '  小小梦工场  ' } });
  assert.equal(p.data.confirmInput, '  小小梦工场  ');
  assert.equal(p.data.confirmOk, true, '首尾空格应被忽略并立即判定为匹配');

  p.onConfirmInput({ detail: { value: '小小梦工厂' } });
  assert.equal(p.data.confirmOk, false, '错别字必须判为不匹配');
});

test('AS9 昵称为空：要求输入「注销」', () => {
  const p = boot();
  p.data.nickname = '';
  p.data.confirmInput = '注销';
  p.recheck();
  assert.equal(p.data.confirmOk, true);

  p.data.confirmInput = '别的';
  p.recheck();
  assert.equal(p.data.confirmOk, false);
});

test('AS10 不匹配时提交：不发请求，给出提示', async () => {
  postCalls = [];
  const p = boot();
  p.data.nickname = '小明';
  p.data.confirmInput = '小红';
  p.data.confirmOk = false;
  await p.submitDeactivate();
  assert.deepEqual(postCalls, [], '不匹配不该发注销请求');
  assert.ok(p.data.confirmError.includes('昵称不匹配'));
});

test('AS11 匹配时提交：调用注销接口并清登录态、回首页', async () => {
  postCalls = [];
  const before = loggedOut;
  const p = boot();
  p.data.nickname = '小明';
  p.data.confirmInput = '小明';
  p.data.confirmOk = true;
  await p.submitDeactivate();
  await new Promise((r) => setTimeout(r, 900));

  assert.equal(postCalls.length, 1);
  assert.equal(postCalls[0].p, '/users/me/deactivate');
  assert.equal(postCalls[0].body.confirm, '小明');
  assert.equal(loggedOut, before + 1, '注销后应清本地登录态');
  assert.ok(navigations.includes('/pages/index/index'), '应回到首页');
});

test('AS12 接口失败：显示错误、可重试（不清登录态）', async () => {
  postCalls = [];
  postShouldFail = Object.assign(new Error('昵称不匹配，请重新输入当前昵称'), {});
  const before = loggedOut;
  const p = boot();
  p.data.nickname = '小明';
  p.data.confirmInput = '小明';
  p.data.confirmOk = true;
  await p.submitDeactivate();

  assert.ok(p.data.confirmError.includes('昵称不匹配'), '应展示服务端提示');
  assert.equal(p.data.submitting, false, '失败后要能再次提交');
  assert.equal(loggedOut, before, '失败不该清登录态');
  postShouldFail = null;
});

test('AS13 提交中不接受重复点击', async () => {
  postCalls = [];
  const p = boot();
  p.data.nickname = '小明';
  p.data.confirmInput = '小明';
  p.data.confirmOk = true;
  p.data.submitting = true;
  await p.submitDeactivate();
  assert.deepEqual(postCalls, [], '提交中再点不该重复发请求');
});
/* 游客态（2026-11-17）：/users/me 需要登录，未登录不该请求 */
test('AS14 游客进页：不请求 /users/me，标记 notLoggedIn', async () => {
  const gets = [];
  const origGet = fakeApi.get;
  fakeApi.get = (p) => { gets.push(p); return origGet(p); };
  appLoggedIn = false;
  appGlobalData.loggedIn = false;
  try {
    const p = boot();
    await p.loadProfile();
    assert.deepEqual(gets, [], '游客态不该请求任何接口');
    assert.equal(p.data.notLoggedIn, true);
  } finally {
    fakeApi.get = origGet;
    appLoggedIn = true;
    appGlobalData.loggedIn = true;
  }
});

test('AS15 游客态 WXML：两张卡在 !notLoggedIn 内，引导用 guest-hint', () => {
  const w = read('pages/account-security/account-security.wxml');
  assert.ok(w.includes('<guest-hint'), '应使用 guest-hint');
  const guardIdx = w.indexOf('<block wx:else>');
  assert.ok(guardIdx > 0, '应有 wx:else 守卫');
  // 按 class 定位卡片（不能按文案找——guest-hint 的 tip 里也含「退出登录/注销账号」字样）
  assert.ok(w.indexOf('action-card"') > guardIdx, '退出登录卡应在守卫内');
  assert.ok(w.indexOf('danger-card"') > guardIdx, '注销卡应在守卫内');
});

test('AS16 接口 401（会话失效）也按游客态处理', async () => {
  const origGet = fakeApi.get;
  fakeApi.get = () => Promise.reject(Object.assign(new Error('未授权'), { statusCode: 401 }));
  appLoggedIn = true;
  appGlobalData.loggedIn = true;
  try {
    const p = boot();
    await p.loadProfile();
    assert.equal(p.data.notLoggedIn, true, '401 应识别为游客态');
  } finally {
    fakeApi.get = origGet;
  }
});

/* 隐私与政策（2026-11-17 从设置页移来）：放在账号与安全最下方，游客也能看 */
test('AS17 隐私与政策卡片在最下方，且在游客守卫之外（游客也能看）', () => {
  const w = read('pages/account-security/account-security.wxml');
  assert.ok(w.includes('隐私与政策'), '应有隐私与政策入口');
  // 位置：在注销卡之后
  assert.ok(w.indexOf('policy-card"') > w.indexOf('danger-card"'), '隐私卡片应在注销卡下方');
  // 不在 block wx:else 内 → 游客可见（block 结束标签应出现在 policy-card 之前）
  const blockEnd = w.indexOf('</block>');
  assert.ok(blockEnd > 0 && blockEnd < w.indexOf('policy-card"'), '隐私卡片应放在 block 之外（游客也能看）');
});

test('AS18 点击隐私卡片跳到隐私政策页', () => {
  const captured = [];
  const origNav = global.wx.navigateTo;
  global.wx.navigateTo = (o) => captured.push(o.url);
  try {
    const p = boot();
    p.openPrivacy();
    assert.deepEqual(captured, ['/pages/privacy/privacy']);
  } finally {
    global.wx.navigateTo = origNav;
  }
});

test('AS19 设置页不再有隐私政策入口（已迁走）', () => {
  const w = read('pages/settings/settings.wxml');
  const js = read('pages/settings/settings.js');
  assert.ok(!w.includes('隐私政策'), '设置页不该再有隐私政策卡片');
  assert.ok(!/openPrivacy/.test(js), '设置页不该再有 openPrivacy');
});

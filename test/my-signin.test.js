/**
 * 我的页签到条：快捷签到状态与直签（方案 D——积分入口收窄后的浅层签到）
 * - 游客不渲染（signin.loaded=false）
 * - 已登录未签到：整条可点 → POST /points/sign-in → 原地翻转 + toast
 * - 已签到：点击进积分页（/pages/points/points）
 * 运行：npm test（node --test 自动发现）
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const apiPath = require.resolve('../miniprogram/services/api.js');
const apiCalls = [];
const toasts = [];
const navs = [];
let appLoggedIn = true;
let summaryResp = null;
let postResp = {};
let postErr = null;

require.cache[apiPath] = {
  id: apiPath,
  filename: apiPath,
  loaded: true,
  children: [],
  paths: [],
  exports: {
    get: async (url) => {
      apiCalls.push('GET ' + url);
      if (url === '/points/summary') return summaryResp;
      if (url === '/users/me') {
        return { nickname: '小小梦工场', avatarPreset: 'runner', uid: 1004, createdAt: '2026-01-01T00:00:00Z' };
      }
      if (url === '/stats/overview') return { today: { distance: 0 }, week: { distance: 0 }, month: { distance: 0 } };
      if (url === '/notifications/summary') return { unreadCount: 0 };
      return {};
    },
    post: async (url) => {
      apiCalls.push('POST ' + url);
      if (postErr) throw postErr;
      return postResp;
    },
  },
};

const toastsArr = toasts; // 别名（下方断言用）
global.wx = {
  showToast: (o) => toasts.push(o && o.title),
  navigateTo: (o) => navs.push(o && o.url),
  getStorageSync: () => ({}),
  setStorageSync: () => {},
};
global.getApp = () => ({
  hasSession: () => appLoggedIn,
  globalData: { loggedIn: appLoggedIn },
  login: async () => {},
});

let pageDef = null;
global.Page = (def) => {
  pageDef = def;
};

require('../miniprogram/pages/my/my.js');
assert.ok(pageDef, 'my.js 应通过 Page() 交出页面对象');

const tick = () => new Promise((r) => setImmediate(r));

function reset({ loggedIn = true } = {}) {
  apiCalls.length = 0;
  toasts.length = 0;
  navs.length = 0;
  appLoggedIn = loggedIn;
  summaryResp = {
    balance: 10,
    signin: { todaySigned: false, streakDay: 0, nextReward: 1, cards: 0, cells: [] },
    tasks: [],
    items: [],
  };
  // POST /points/sign-in 的真实返回形状：SigninResult 顶层平铺（无 signin 嵌套）
  postResp = { credited: 1, balance: 11, todaySigned: true, streakDay: 1, nextReward: 2 };
  postErr = null;
}

function boot() {
  const p = Object.assign({}, pageDef);
  p.data = JSON.parse(JSON.stringify(pageDef.data));
  p.setData = (patch = {}) => Object.assign(p.data, patch);
  return p;
}

test('MS1 游客：不渲染签到条（loggedIn false 且无签到数据）', async () => {
  reset({ loggedIn: false });
  const p = boot();
  await p.refreshUser();
  await tick();
  assert.equal(p.data.loggedIn, false);
  assert.equal(p.data.signin.loaded, false, '游客不拉积分汇总，条不出现');
  assert.ok(!apiCalls.some((c) => c.includes('/points/')), '游客不发积分请求');
});

test('MS2 已登录未签到：签到条就绪，点击直接签到并原地翻转', async () => {
  reset();
  const p = boot();
  await p.refreshUser();
  await tick();
  assert.equal(p.data.signin.loaded, true);
  assert.equal(p.data.signin.signedToday, false);
  assert.equal(p.data.signin.nextReward, 1);

  await p.onSigninStripTap();
  assert.ok(apiCalls.some((c) => c === 'POST /points/sign-in'), '条上直接 POST 签到');
  assert.equal(p.data.signin.signedToday, true, '原地翻转为已签');
  assert.equal(p.data.signin.balance, 11);
  assert.ok(toasts.some((t) => t === '签到成功 +1'), `toast=${JSON.stringify(toasts)}`);
  assert.deepEqual(navs, [], '未签不跳页，原地完成');
});

test('MS3 已签到：点击进积分页（不再重复发请求）', async () => {
  reset();
  const p = boot();
  await p.refreshUser();
  await tick();
  p.setData({ signin: { ...p.data.signin, signedToday: true } });
  await p.onSigninStripTap();
  assert.deepEqual(navs, ['/pages/points/points'], '已签点击跳积分页');
  assert.ok(!apiCalls.some((c) => c === 'POST /points/sign-in'), '已签不重复 POST');
});

test('MS4 快捷签到失败：toast 提示且不翻转状态', async () => {
  reset();
  const p = boot();
  await p.refreshUser();
  await tick();
  postErr = new Error('网络开小差');
  await p.onSigninStripTap();
  assert.equal(p.data.signin.signedToday, false, '失败不翻转');
  assert.ok(toasts.some((t) => t === '网络开小差'), `toast=${JSON.stringify(toasts)}`);
});

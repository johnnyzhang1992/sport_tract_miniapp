/**
 * 数据概览页回归（2026-11-05，运营中心收敛为只读后）：
 * 1) 结构：app.json 注册、会员中心入口仅运营者可见；
 * 2) 未授权（403 仅运营者）→ 不进列表态也不误报失败；
 * 3) 概览六项指标渲染。
 * 桩：wx / Page 就地 stub，services/api、services/storage、utils/login-gate 用 require.cache 注入。
 * 运行：node --test test/operator-page.test.js；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('OP1 app.json 注册数据概览页，会员中心入口仅运营者可见', () => {
  const app = JSON.parse(read('miniprogram/app.json'));
  assert.ok(app.pages.includes('pages/operator/operator'));
  const memberWxml = read('miniprogram/pages/member/member.wxml');
  assert.ok(memberWxml.includes('wx:if="{{operator}}"'), '入口必须挂服务端 operator 旗标');
  assert.match(memberWxml, /数据概览/);
  assert.ok(read('miniprogram/pages/member/member.js').includes("'/pages/operator/operator'"));
});

/* --------------------------------- 环境桩 --------------------------------- */

let apiGets = [];
let apiPosts = [];
let respond = null;
let modals = [];
let toasts = [];
let token = { accessToken: 't' };

const fakeApi = {
  get(p) { apiGets.push(p); return respond(p); },
  post(p, body) { apiPosts.push({ p, body }); return respond(p, body); },
};
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };

const storagePath = require.resolve('../miniprogram/services/storage.js');
require.cache[storagePath] = {
  id: storagePath, filename: storagePath, loaded: true, exports: { getToken: () => token }, children: [], paths: [],
};

const loginGatePath = require.resolve('../miniprogram/utils/login-gate.js');
require.cache[loginGatePath] = {
  id: loginGatePath, filename: loginGatePath, loaded: true,
  exports: { ensureLogin: () => { token = { accessToken: 't2' }; return Promise.resolve(true); } },
  children: [], paths: [],
};

global.wx = {
  getSystemInfoSync: () => ({ platform: 'android', SDKVersion: '3.0.0', version: '8.0.68' }),
  showToast: (o) => toasts.push(o && o.title),
  showModal: (o) => { modals.push(o && o.title); o.success({ confirm: true }); },
  stopPullDownRefresh: () => {},
};

let pageDef = null;
global.Page = (def) => { pageDef = def; };
require('../miniprogram/pages/operator/operator.js');
assert.ok(pageDef, 'operator.js 应通过 Page() 交出页面对象');

/* --------------------------------- 装配 --------------------------------- */

const tick = () => new Promise((r) => setImmediate(r));

const respondWith = (over) => (p) => {
  if (p === '/operator/me') return Promise.resolve({ role: 'admin', uid: 1001, nickname: '运营', capabilities: ['stats'] });
  if (p === '/operator/stats/summary') {
    return Promise.resolve({
      today: { date: 1, uv: 5, pv: 9, tracksCreated: 2, tracksFinished: 1, signinUsers: 3, newUsers: 1 },
      yesterday: { date: 2, uv: 4, pv: 8, tracksCreated: 1, tracksFinished: 1, signinUsers: 2, newUsers: 0 },
      generatedAt: 1,
    });
  }
  return Promise.resolve({});
};

function reset(over) {
  apiGets = []; apiPosts = []; modals = []; toasts = [];
  token = over && over.loggedOut ? null : { accessToken: 't' };
  respond = respondWith(over);
  pageDef.data = { loading: true, failed: false, loggedIn: false, authorized: false, summary: null, items: [], expanded: '', preview: null, previewLoading: false, reasonIndex: -1, note: '', busy: '' };
  pageDef.setData = (patch) => { Object.assign(pageDef.data, patch || {}); };
  return pageDef;
}

/* --------------------------------- 用例 --------------------------------- */

test('OP2 未授权（403 仅运营者）→ 不进列表态也不误报加载失败', async () => {
  reset();
  respondWith.call(null);
  // 临时把 me 换成 403 形态：fakeApi 抛错模拟守卫
  fakeApi.get = (p) => { if (p === '/operator/me') return Promise.reject(new Error('仅运营者可用')); return respond(p); };
  pageDef.onShow();
  await tick();
  assert.equal(pageDef.data.authorized, false);
  assert.equal(pageDef.data.failed, false, '403 是权限态不是失败态');
  fakeApi.get = (p) => respond(p);
});

test('OP3 概览渲染：今日/昨日六项指标齐备', async () => {
  reset();
  pageDef.onShow();
  await tick();
  assert.equal(pageDef.data.authorized, true);
  assert.equal(pageDef.data.summary.today.uv, 5);
  assert.equal(pageDef.data.summary.yesterday.newUsers, 0);
});


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
  if (p.startsWith('/operator/stats/trend')) {
    const q = new URLSearchParams(p.split('?')[1]);
    const n = q.get('range') === 'week' ? 7 : q.get('range') === 'month' ? 30 : 26;
    const buckets = Array.from({ length: n }, (_, i) => ({
      key: `k${i}`, label: `11/${i + 1}`, newUsers: i, uv: i + 1, pv: i + 2, tracksCreated: i + 3,
    }));
    return Promise.resolve({ range: q.get('range'), granularity: q.get('granularity'), buckets });
  }
  return Promise.resolve({});
};

function reset(over) {
  apiGets = []; apiPosts = []; modals = []; toasts = [];
  token = over && over.loggedOut ? null : { accessToken: 't' };
  respond = respondWith(over);
  pageDef.data = { loading: true, failed: false, loggedIn: false, authorized: false, summary: null, items: [], expanded: '', preview: null, previewLoading: false, reasonIndex: -1, note: '', busy: '', range: 'week', granularity: 'day', userChart: null, trackChart: null, trendLoading: false, trendFailed: false };
  pageDef._trendSeq = 0;
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
  fakeApi.get = (p) => { apiGets.push(p); return respond(p); };
});

test('OP3 概览渲染：今日/昨日六项指标齐备', async () => {
  reset();
  pageDef.onShow();
  await tick();
  assert.equal(pageDef.data.authorized, true);
  assert.equal(pageDef.data.summary.today.uv, 5);
  assert.equal(pageDef.data.summary.yesterday.newUsers, 0);
});

test('OP4 进页拉趋势：默认 week/day；三系列与轨迹图数据齐备', async () => {
  reset();
  pageDef.onShow();
  await tick();
  await tick();
  assert.ok(apiGets.includes('/operator/stats/trend?range=week&granularity=day'), apiGets.join(','));
  assert.deepEqual(pageDef.data.userChart.series.map((s) => s.name), ['新增用户', '登录UV', '登录PV']);
  assert.equal(pageDef.data.userChart.labels.length, 7);
  assert.equal(pageDef.data.trackChart.length, 7);
  assert.equal(pageDef.data.trackChart[0].value, 3);
  assert.equal(pageDef.data.trendFailed, false);
});

test('OP5 切范围：半年回退周粒度、一周回退天粒度；请求带新参数', async () => {
  reset();
  pageDef.onShow();
  await tick();
  await tick();
  pageDef.onRange({ currentTarget: { dataset: { key: 'halfyear' } } });
  assert.equal(pageDef.data.granularity, 'week', '半年天粒度禁用→回退周');
  assert.equal(pageDef.data.granOptions.find((o) => o.key === 'day').disabled, true);
  await tick();
  assert.ok(apiGets.includes('/operator/stats/trend?range=halfyear&granularity=week'));
  assert.equal(pageDef.data.userChart.labels.length, 26);

  pageDef.onRange({ currentTarget: { dataset: { key: 'week' } } });
  assert.equal(pageDef.data.granularity, 'day', '一周周粒度禁用→回退天');
  await tick();
  assert.ok(apiGets.includes('/operator/stats/trend?range=week&granularity=day'));
});

test('OP6 禁用粒度点击无效；可用粒度切换发请求', async () => {
  reset();
  pageDef.onShow();
  await tick();
  await tick();
  const before = apiGets.length;
  pageDef.onGran({ currentTarget: { dataset: { key: 'week', disabled: true } } });
  await tick();
  assert.equal(apiGets.length, before, '一周的周粒度禁用，点了不发请求');
  assert.equal(pageDef.data.granularity, 'day');

  pageDef.onRange({ currentTarget: { dataset: { key: 'month' } } });
  await tick();
  pageDef.onGran({ currentTarget: { dataset: { key: 'week', disabled: false } } });
  await tick();
  assert.ok(apiGets.includes('/operator/stats/trend?range=month&granularity=week'));
});

test('OP7 快切范围序号守卫：慢的旧响应不覆盖新响应', async () => {
  reset();
  pageDef.onShow();
  await tick();
  await tick();
  let releaseOld;
  const realRespond = respond;
  respond = (p) => {
    if (p.startsWith('/operator/stats/trend') && p.includes('range=month')) {
      return new Promise((r) => { releaseOld = () => r(realRespond(p)); });
    }
    return realRespond(p);
  };
  pageDef.onRange({ currentTarget: { dataset: { key: 'month' } } }); // 挂起
  pageDef.onRange({ currentTarget: { dataset: { key: 'halfyear' } } }); // 最新
  await tick();
  assert.equal(pageDef.data.userChart.labels.length, 26, '新响应已上屏');
  releaseOld();
  await tick();
  assert.equal(pageDef.data.userChart.labels.length, 26, '旧响应回来不能覆盖');
  assert.equal(pageDef.data.range, 'halfyear');
});

test('OP8 趋势结构：范围/粒度 chips + 分组柱 + 轨迹柱都挂对组件与 handler', () => {
  const w = read('miniprogram/pages/operator/operator.wxml');
  assert.match(w, /bindtap="onRange"/);
  assert.match(w, /bindtap="onGran"/);
  assert.match(w, /type="grouped-bar"/);
  assert.match(w, /series="{{userChart.series}}"/);
  assert.match(w, /data="{{trackChart}}"/);
  assert.equal((w.match(/show-tip="\{\{true\}\}"/g) || []).length, 2, '两张图都打开点柱看数');
  const cfg = JSON.parse(read('miniprogram/pages/operator/operator.json'));
  assert.ok(cfg.usingComponents && cfg.usingComponents['stat-chart'], 'stat-chart 组件要注册');
});


/**
 * 轨迹页（pages/tracks/tracks.js）标题条数回归：
 * 标题「N 条轨迹」取 /activities 返回的 total（＝当前筛选命中的总条数），
 * 不是已加载的 items.length（分页 20 条会少报）；切类型 Tab 后随新 total 变；删除一条后本地减 1。
 * 运行：npm test；桩：wx / Page / getApp 就地 stub，services/api 用 require.cache 注入假实现。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

/* ---------------------------------- 环境桩 ---------------------------------- */

const apiCalls = [];
let activitiesRespond = () => Promise.resolve({ items: [], total: 0, monthlyStats: [] });
const fakeApi = {
  get(p, params) {
    apiCalls.push({ p, params });
    return activitiesRespond(p, params);
  },
  del(p) {
    apiCalls.push({ p });
    return Promise.resolve({});
  },
};
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };

const toasts = [];
global.wx = {
  getStorageSync: () => '',
  showModal: (o) => o.success && o.success({ confirm: true }),
  showToast: (o) => toasts.push(o && o.title),
};
let pageDef = null;
global.Page = (def) => { pageDef = def; };
global.getApp = () => ({ globalData: { loggedIn: true }, hasSession: () => true });

require('../miniprogram/pages/tracks/tracks.js');
assert.ok(pageDef, 'tracks.js 应通过 Page() 交出页面对象');

/* --------------------------------- 页面装配 --------------------------------- */

function applyPath(target, keyPath, value) {
  const keys = keyPath.split('.');
  let o = target;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
}

function makePage() {
  const p = Object.assign({}, pageDef);
  p.data = JSON.parse(JSON.stringify(pageDef.data));
  p.setData = (patch = {}) => Object.keys(patch).forEach((k) => applyPath(p.data, k, patch[k]));
  return p;
}

/** 等 setData 的微任务链跑完（onTabChange 不返回 refresh 的 promise） */
const flush = () => new Promise((r) => setImmediate(r));
const lastActivities = () => apiCalls.filter((c) => c.p === '/activities').pop();

/* ---------------------------------- 用例 ---------------------------------- */

test('标题条数取接口 total，而非已加载条数（分页首屏 20 条也要显示 42）', async () => {
  activitiesRespond = () => Promise.resolve({ items: [], total: 42, monthlyStats: [] });
  const p = makePage();
  await p.refresh();
  assert.equal(p.data.totalCount, 42, '标题条数应等于接口 total，不受 PAGE_SIZE 截断');
});

test('切类型 Tab 后条数跟随新筛选的 total（请求带 type）', async () => {
  const p = makePage();
  activitiesRespond = () => Promise.resolve({ items: [], total: 42, monthlyStats: [] });
  await p.refresh();
  assert.equal(p.data.totalCount, 42);

  activitiesRespond = () => Promise.resolve({ items: [], total: 7, monthlyStats: [] });
  p.onTabChange({ detail: { value: 'running' } });
  await flush();
  assert.equal(lastActivities().params.type, 'running', '切 Tab 后应按新类型请求');
  assert.equal(p.data.totalCount, 7, '条数应跟随当前筛选');
});

test('上拉加载更多时标题条数以后端最新 total 为准', async () => {
  activitiesRespond = () => Promise.resolve({ items: [], total: 42, monthlyStats: [] });
  const p = makePage();
  await p.refresh();
  activitiesRespond = () => Promise.resolve({ items: [], total: 43, monthlyStats: [] });
  await p.loadMore();
  assert.equal(p.data.totalCount, 43, 'loadMore 响应里的 total 应刷新标题条数');
});

test('删除一条轨迹后标题条数本地减 1', async () => {
  activitiesRespond = () => Promise.resolve({ items: [], total: 3, monthlyStats: [] });
  const p = makePage();
  await p.refresh();
  p.setData({ items: [{ id: 'a1', label: '跑步', startTimeText: '9/1 08:00' }] });
  await p.onDeleteTap({ currentTarget: { dataset: { id: 'a1' } } });
  assert.equal(p.data.totalCount, 2, '删除成功后条数应减 1');
});

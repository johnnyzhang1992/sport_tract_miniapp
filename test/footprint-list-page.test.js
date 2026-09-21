/**
 * 足迹列表独立页（pages/footprint-list/footprint-list.js）页级回归：
 * 列表形态从 footprints 页迁出后独占一页，原「触底翻页三条件回退闸门」「seq 守卫」「toCard 字段映射」
 * 「详情/表单组件接线」都要保住，另加本页新增的下拉刷新与首屏/刷新失败分档。
 * 运行：npm test（node --test 自动发现）；依赖：仅 node 内置模块。
 * 桩：wx / Page / getApp 就地 stub；services/api 用 require.cache 注入假实现（绕开 config/storage 的真实
 *     wx 依赖）；respond 钩子按 { path, params } 决定这一轮返回什么，用例内逐条改写。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/* ---------------------------------- 环境桩 ---------------------------------- */

const apiCalls = [];
/** 用例内改写的响应钩子：(path, params) => Promise<data> */
let respond = () => Promise.resolve({ items: [], total: 0 });
const fakeApi = {
  get(p, params) {
    apiCalls.push({ path: p, params });
    return respond(p, params);
  },
  del() {
    return Promise.resolve({});
  },
};
const apiPath = require.resolve(path.join(ROOT, 'miniprogram/services/api.js'));
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };

const toasts = [];
let stopPullDownCalls = 0;
global.wx = {
  showToast: (o) => toasts.push(o && o.title),
  navigateTo() {},
  stopPullDownRefresh: () => { stopPullDownCalls++; },
};
let pageDef = null;
global.Page = (def) => { pageDef = def; };
global.getApp = () => ({ globalData: {} });

require(path.join(ROOT, 'miniprogram/pages/footprint-list/footprint-list.js'));
assert.ok(pageDef, 'footprint-list.js 应通过 Page() 交出页面对象');

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
  p.setData = (patch, cb) => {
    Object.keys(patch).forEach((k) => applyPath(p.data, k, patch[k]));
    if (cb) cb();
  };
  return p;
}

const tick = () => new Promise((r) => setImmediate(r));
/** 排空 promise 链（loadAll → fetchPage → setData） */
async function flush() {
  for (let i = 0; i < 5; i++) await tick();
}

/** 一条记录（卡片字段由 toCard 补齐，用例只给原始 DTO 形态） */
function rec(id, over = {}) {
  return Object.assign({ id, title: '足迹' + id, visitDate: '2026-05-01', people: [], photos: [], location: {} }, over);
}

/** 分页桩：按 params.page/pageSize 从 all 里切一页，total 恒为 all.length */
function pagedRespond(all) {
  return (p, params) => {
    const start = (params.page - 1) * params.pageSize;
    return Promise.resolve({ items: all.slice(start, start + params.pageSize), total: all.length });
  };
}

function resetEnv() {
  apiCalls.length = 0;
  toasts.length = 0;
  stopPullDownCalls = 0;
  respond = () => Promise.resolve({ items: [], total: 0 });
}

/* ---------------------------------- 用例 ---------------------------------- */

test('L1 首屏：GET /footprint-records page=1 替换整页，卡片字段由 toCard 算好', async () => {
  resetEnv();
  respond = (p, params) => {
    assert.equal(p, '/footprint-records');
    assert.deepEqual(params, { page: 1, pageSize: 20 });
    return Promise.resolve({
      total: 2,
      items: [
        rec('a', { people: ['小李', '', null], photos: ['https://cdn/1.jpg'], location: { city: '杭州市' } }),
        rec('b', { location: { name: '故宫' } }),
      ],
    });
  };
  const page = makePage();
  const running = page.loadAll();
  assert.equal(page.data.loading, true, '首屏进 loading 态');
  await running;
  assert.equal(page.data.loading, false);
  assert.equal(page.data.items.length, 2);
  assert.equal(page.data.items[0].peopleText, '小李', 'people 过滤空值后 join（wxml 不能 join 数组）');
  assert.equal(page.data.items[0].subText, '2026-05-01 · 杭州市', 'subText = 日期 · 城市');
  assert.equal(page.data.items[0].cover, 'https://cdn/1.jpg', 'cover 取首图');
  assert.equal(page.data.items[1].peopleText, '');
  assert.equal(page.data.items[1].subText, '2026-05-01 · 故宫', '无 city 时回落 name/address');
  assert.equal(page.data.items[1].cover, '');
  assert.equal(page.data.hasMore, false, '2 条已达 total → 到底');
});

test('L2 触底翻页：第二页追加不覆盖，到底后闸门拦住不再请求', async () => {
  resetEnv();
  respond = pagedRespond([rec('a'), rec('b'), rec('c')]);
  const page = makePage();
  page.setData({ pageSize: 2 }); // 缩小页长，3 条数据刚好两页
  await page.loadAll();
  assert.deepEqual(page.data.items.map((r) => r.id), ['a', 'b']);
  assert.equal(page.data.hasMore, true, 'items(2) < total(3) → 还有下一页');

  page.onReachBottom();
  await flush();
  assert.deepEqual(page.data.items.map((r) => r.id), ['a', 'b', 'c'], '第二页追加（不覆盖第一页）');
  assert.equal(page.data.page, 2);
  assert.equal(page.data.hasMore, false, 'fresh 非空且 items.length === total');
  assert.equal(page.data.loadingList, false, '尾提示收起');

  const calls = apiCalls.length;
  page.onReachBottom();
  await flush();
  assert.equal(apiCalls.length, calls, '已到底：触底不再发请求');
});

test('L3 翻页失败：页码退回上一页（seq/loadingList/page 三条件）；加载中触底不重入', async () => {
  resetEnv();
  respond = pagedRespond([rec('a'), rec('b'), rec('c')]);
  const page = makePage();
  page.setData({ pageSize: 2 });
  await page.loadAll();

  respond = () => Promise.reject(new Error('网络错误'));
  page.onReachBottom();
  assert.equal(page.data.page, 2, '发请求前先占住页码');
  const inFlight = page.data.loadingList;
  assert.equal(inFlight, true, '翻页中 loadingList 为真');
  page.onReachBottom(); // 重入：闸门应拦住
  assert.equal(apiCalls.length, 2, '同一页不会重复发请求（总共 首屏 + 1 次翻页）');
  await flush();
  assert.equal(page.data.page, 1, '翻页失败要退回页码，否则这次触底白翻一页、数据留空洞');
  assert.equal(page.data.loadingList, false);
  assert.equal(page.data.items.length, 2, '失败不清空已渲染内容');
});

test('L4 失败分档：首屏失败整页错误态，刷新失败保留内容只 toast', async () => {
  resetEnv();
  respond = () => Promise.reject(new Error('加载失败X'));
  const page = makePage();
  await page.loadAll();
  assert.equal(page.data.error, '加载失败X', '首屏失败没有可展示内容 → 整页错误态');
  assert.equal(page.data.loading, false);

  respond = pagedRespond([rec('a')]);
  await page.loadAll();
  assert.equal(page.data.error, '');
  assert.equal(page.data.items.length, 1);

  respond = () => Promise.reject(new Error('刷新失败Y'));
  await page.loadAll();
  assert.equal(page.data.error, '', '刷新失败仍保留已渲染列表，不切整页错误态');
  assert.equal(page.data.items.length, 1, '刷新失败不清空 items');
  assert.equal(toasts[toasts.length - 1], '刷新失败Y', '刷新失败用 toast 提示');
});

test('L5 下拉刷新：重拉第一页并收起下拉指示器', async () => {
  resetEnv();
  respond = pagedRespond([rec('a'), rec('b')]);
  const page = makePage();
  await page.loadAll();
  page.setData({ page: 2 });
  page.onPullDownRefresh(); // 页面方法自己不返回 promise，收尾在 loadAll().finally 里
  await flush();
  assert.equal(page.data.page, 1, '下拉刷新回第一页');
  assert.equal(stopPullDownCalls, 1, 'loadAll 完成后必须 stopPullDownRefresh');
  assert.equal(apiCalls[apiCalls.length - 1].params.page, 1);
});

test('L6 详情/表单接线：点卡片走完整 DTO 快路径；保存与删除后都重拉第一页', async () => {
  resetEnv();
  respond = pagedRespond([rec('a'), rec('b'), rec('c')]);
  const page = makePage();
  page.setData({ pageSize: 2 });
  await page.loadAll();

  const callsBefore = apiCalls.length;
  page.onCardTap({ currentTarget: { dataset: { idx: 1 } } });
  assert.equal(page.data.detailVisible, true);
  assert.equal(page.data.detailRecord.id, 'b', 'items 是完整 DTO：详情组件走快路径');
  assert.equal(apiCalls.length, callsBefore, '点卡片不再补拉详情');

  page.onDetailEdit({ detail: page.data.detailRecord });
  assert.equal(page.data.detailVisible, false, '开表单前先关详情');
  assert.equal(page.data.detailRecord, null);
  assert.equal(page.data.formVisible, true);
  assert.equal(page.data.formRecord.id, 'b');

  page.setData({ page: 3 }); // 页码停在深页时保存
  page.onFormSaved();
  assert.equal(page.data.formVisible, false);
  await flush();
  assert.equal(apiCalls[apiCalls.length - 1].params.page, 1, '保存后重拉第一页（不留在深页区间）');
  assert.equal(page.data.page, 1);

  page.setData({ detailVisible: true, detailRecord: rec('a') });
  page.onDetailDeleted();
  assert.equal(page.data.detailVisible, false);
  assert.equal(page.data.detailRecord, null);
  await flush();
  assert.equal(apiCalls[apiCalls.length - 1].params.page, 1, '删除后也回第一页重拉');

  page.closeDetail();
  assert.equal(page.data.detailVisible, false);
});

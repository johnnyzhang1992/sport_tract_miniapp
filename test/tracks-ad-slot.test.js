/**
 * 轨迹页广告位规则：只插在「第 3 条轨迹」后面，不足 3 条不展示。
 * 覆盖列表模式（按月分组）与卡片模式（items）两种渲染数据源，以及分页追加后标记不漂。
 * 运行：npm test；桩：wx / Page / getApp 就地 stub，services/api 用 require.cache 注入假实现。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

/* ---------------------------------- 环境桩 ---------------------------------- */

const fakeApi = {
  get(p) {
    if (p === '/stats/best') return Promise.resolve(null);
    if (p === '/activities') return activitiesRespond();
    return Promise.resolve({});
  },
  del() {
    return Promise.resolve({});
  },
};
let activitiesRespond = () => Promise.resolve({ items: [], total: 0, monthlyStats: [] });
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };

global.wx = {
  getStorageSync: () => '',
  showModal: (o) => o.success && o.success({ confirm: true }),
  showToast: () => {},
};
let pageDef = null;
global.Page = (def) => { pageDef = def; };
global.getApp = () => ({ globalData: { loggedIn: true }, hasSession: () => true });

require('../miniprogram/pages/tracks/tracks.js');
assert.ok(pageDef, 'tracks.js 应通过 Page() 交出页面对象');

/* --------------------------------- 工具 --------------------------------- */

function makePage() {
  const p = Object.assign({}, pageDef);
  p.data = JSON.parse(JSON.stringify(pageDef.data));
  p.setData = (patch = {}) => Object.assign(p.data, patch);
  return p;
}

/** 造 n 条轨迹（时间倒序：越靠前越新，跨月份各 1 条，便于验证跨组场景） */
function makeItems(n) {
  const base = Date.UTC(2026, 9, 20, 4, 0, 0);
  return Array.from({ length: n }, (_, i) => ({
    _id: `id${i}`,
    id: `id${i}`,
    type: 'walking',
    startTime: base - i * 30 * 86400000, // 每条间隔约一个月，保证落在不同月份组
    distance: 1000 - i,
    duration: 600000,
    calories: 50,
  }));
}

const respondWith = (n, total = n) => () =>
  Promise.resolve({ items: makeItems(n), total, monthlyStats: [] });

/** 已标记为「广告插在其后」的条目在 items 里的下标 */
const adIdx = (items) => items.flatMap((it, i) => (it.adAfter ? [i] : []));

/* ---------------------------------- 用例 ---------------------------------- */

test('AS1 刷新后有且只有第 3 条（index 2）带 adAfter', async () => {
  activitiesRespond = respondWith(5);
  const p = makePage();
  await p.refresh();
  assert.equal(p.data.items.length, 5);
  assert.deepEqual(adIdx(p.data.items), [2], 'adAfter 只能落在第 3 条');
});

test('AS2 按月分组后，第 3 条所在分组里它也带 adAfter（列表模式数据源一致）', async () => {
  activitiesRespond = respondWith(5);
  const p = makePage();
  await p.refresh();
  const third = p.data.items[2];
  const group = p.data.groups.find((g) => g.items.includes(third));
  assert.ok(group, '第 3 条应能在某个月份分组里找到');
  assert.equal(group.items.filter((it) => it.adAfter).length, 1, '整个分组里只有一条带标记');
  assert.equal(group.items.find((it) => it.adAfter), third, '带标记的必须就是第 3 条');
});

test('AS3 只有 2 条轨迹时没有任何条目带 adAfter（不足 3 条不展示）', async () => {
  activitiesRespond = respondWith(2);
  const p = makePage();
  await p.refresh();
  assert.equal(p.data.items.length, 2);
  assert.deepEqual(adIdx(p.data.items), [], '不足 3 条时不该有广告位');
  assert.equal(p.data.groups.flatMap((g) => g.items).filter((it) => it.adAfter).length, 0);
});

test('AS4 恰好 3 条：第 3 条带标记（边界值）', async () => {
  activitiesRespond = respondWith(3);
  const p = makePage();
  await p.refresh();
  assert.deepEqual(adIdx(p.data.items), [2]);
});

test('AS5 加载更多追加后标记仍只落在第 3 条，不会出现第二个广告位', async () => {
  activitiesRespond = respondWith(20, 40);
  const p = makePage();
  await p.refresh();
  activitiesRespond = respondWith(20, 40);
  await p.loadMore();
  assert.equal(p.data.items.length, 40);
  assert.deepEqual(adIdx(p.data.items), [2], '追加一页后仍只有第 3 条带标记');
});

test('AS6 删除后重拉：新第 3 条接手标记，旧条目不再带', async () => {
  activitiesRespond = respondWith(4);
  const p = makePage();
  await p.refresh();
  assert.deepEqual(adIdx(p.data.items), [2]);
  // 删除第 1 条后重拉，接口返回 3 条（原第 2、3、4 条）
  const rest = makeItems(4).slice(1);
  activitiesRespond = () => Promise.resolve({ items: rest, total: 3, monthlyStats: [] });
  await p.onDeleteTap({ currentTarget: { dataset: { id: 'id0' } } });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(adIdx(p.data.items), [2], '重拉后仍只有第 3 条带标记');
});

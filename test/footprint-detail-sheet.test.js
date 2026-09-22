/**
 * components/footprint-detail 回归：半屏渲染缩略图、点开 previewImage 用原图（缺原图地址时才补拉详情）
 * 桩：Component() 捕获定义；services/api 用 require.cache 注入假实现（计数请求次数、控制返回）。
 * 运行：npm test（node --test 自动发现）；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

let apiCalls = [];
let detailResult = null; // GET /:id 的返回（用例控制）
let detailFails = false;
const fakeApi = {
  get(url) {
    apiCalls.push(url);
    return detailFails ? Promise.reject(new Error('网络不给力')) : Promise.resolve(detailResult);
  },
};
require.cache[require.resolve('../miniprogram/services/api.js')] = {
  id: 'fake-api', filename: 'fake-api', loaded: true, exports: fakeApi, children: [], paths: [],
};

let previews = [];
let toasts = [];
global.wx = {
  previewImage(o) { previews.push(o); },
  showToast(o) { toasts.push(o && o.title); },
  showModal() {},
};
let compDef = null;
global.Component = (def) => { compDef = def; };
require('../miniprogram/components/footprint-detail/footprint-detail.js');
assert.ok(compDef, 'footprint-detail.js 应通过 Component() 交出组件对象');

/** 打开半屏：传 visible + record，走 observers → load()（内部是 Promise，测试里 await tick 收敛） */
async function open(record) {
  const c = Object.assign({}, compDef.methods);
  c.data = JSON.parse(JSON.stringify(compDef.data));
  c.setData = (patch) => Object.assign(c.data, patch);
  c.triggerEvent = () => {};
  c.setData({ visible: true, record });
  compDef.observers['visible, record'].call(c, true);
  for (let i = 0; i < 6; i++) await Promise.resolve();
  return c;
}

const LIST_CARD = {
  id: 'r1',
  title: '西湖',
  visitDate: '2026-09-05',
  description: 'd',
  people: ['小李'],
  location: { city: '杭州市', address: '浙江省杭州市西湖区', latitude: 30.2, longitude: 120.1 },
  photos: ['https://oss/o1.jpg?sig=1', 'https://oss/o2.jpg?sig=1'],
  photoThumbs: ['https://oss/t1.jpg?x-oss-process=thumb', 'https://oss/t2.jpg?x-oss-process=thumb'],
};

test('列表卡快路径：字段齐全就不再补拉详情，格子用缩略图、原图留着预览', async () => {
  apiCalls = [];
  const c = await open(LIST_CARD);
  assert.deepEqual(apiCalls, [], '卡片自带 photoThumbs，不该为了打开半屏再发请求');
  assert.equal(c.data.loading, false);
  assert.deepEqual(c.data.detail.photoThumbs, LIST_CARD.photoThumbs);
  assert.deepEqual(c.data.detail.photos, LIST_CARD.photos);
});

test('地图 geo 轻量点（缺描述/照片）：补拉一次详情，两串都取返回值', async () => {
  apiCalls = [];
  detailResult = Object.assign({}, LIST_CARD, { id: 'r2' });
  const c = await open({ id: 'r2', title: 't', visitDate: '2026-09-05', latitude: 1, longitude: 2 });
  assert.deepEqual(apiCalls, ['/footprint-records/r2']);
  assert.equal(c.data.detail.photos.length, 2);
  assert.equal(c.data.detail.photoThumbs.length, 2);
});

test('点格子看大图：预览的是原图串，current 为点的那张', async () => {
  previews = [];
  const c = await open(LIST_CARD);
  c.previewPhoto({ currentTarget: { dataset: { idx: 1 } } });
  assert.equal(previews.length, 1);
  assert.deepEqual(previews[0].urls, LIST_CARD.photos, '大图不能是缩略图档');
  assert.equal(previews[0].current, LIST_CARD.photos[1]);
});

test('手上没原图地址（只有缩略图的 DTO）：点大图时才补拉详情换原图', async () => {
  previews = [];
  apiCalls = [];
  detailResult = Object.assign({}, LIST_CARD, { id: 'r3' });
  const card = Object.assign({}, LIST_CARD, { id: 'r3' });
  delete card.photos;
  const c = await open(card);
  assert.equal(c.data.detail.photoThumbs.length, 2, '没有原图也要能立刻渲染缩略图');
  c.previewPhoto({ currentTarget: { dataset: { idx: 0 } } });
  for (let i = 0; i < 6; i++) await Promise.resolve();
  assert.deepEqual(apiCalls, ['/footprint-records/r3'], '原图缺位才发这一次请求');
  assert.deepEqual(previews[0].urls, LIST_CARD.photos);
  assert.deepEqual(c.data.detail.photos, LIST_CARD.photos, '补拉到的原图要并回 detail，第二次点不再请求');
});

test('补拉失败：toast 说具体原因，不静默', async () => {
  toasts = [];
  previews = [];
  detailFails = true;
  const card = Object.assign({}, LIST_CARD);
  delete card.photos;
  const c = await open(card);
  c.previewPhoto({ currentTarget: { dataset: { idx: 0 } } });
  for (let i = 0; i < 6; i++) await Promise.resolve();
  detailFails = false;
  assert.equal(previews.length, 0);
  assert.deepEqual(toasts, ['网络不给力']);
});

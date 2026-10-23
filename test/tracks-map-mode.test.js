/**
 * 轨迹页「地图模式」：视口内才拉地图点、成功后缓存、失败降级；
 * 列表项装饰时先用 60 点预览折线，详情点到达后替换。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const calls = [];
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = {
  id: apiPath,
  filename: apiPath,
  loaded: true,
  children: [],
  paths: [],
  exports: {
    get: async (url) => {
      calls.push(url);
      if (url.includes('bad')) throw new Error('boom');
      return {
        total: 2,
        points: [
          { lat: 30, lng: 120 },
          { lat: 31, lng: 121 },
        ],
      };
    },
    del: async () => ({}),
  },
};
const storagePath = require.resolve('../miniprogram/services/storage.js');
require.cache[storagePath] = {
  id: storagePath,
  filename: storagePath,
  loaded: true,
  children: [],
  paths: [],
  exports: { getBestCache: () => null, setBestCache: () => {} },
};

let rects = [];
const fits = [];
global.wx = {
  getStorageSync: () => '',
  setStorageSync: () => {},
  navigateTo: () => {},
  createMapContext: (id) => ({
    includePoints: (opts) => fits.push({ id, opts }),
  }),
  createSelectorQuery: () => ({
    in() {
      return this;
    },
    selectAll() {
      return this;
    },
    boundingClientRect(cb) {
      this.cb = cb;
      return this;
    },
    exec() {
      this.cb(rects);
    },
  }),
};
let pageDef = null;
global.Page = (def) => { pageDef = def; };
global.getApp = () => ({ globalData: {} });

require('../miniprogram/pages/tracks/tracks.js');

function setByPath(obj, path, value) {
  const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (cur[k] == null) cur[k] = {};
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
}

function makePage(items) {
  const page = Object.create(pageDef);
  page.data = { viewMode: 'grid', items };
  page.setData = function (patch) {
    Object.keys(patch).forEach((k) => setByPath(this.data, k, patch[k]));
  };
  return page;
}

test('TM1 只请求可视行地图点；成功后写入折线并缓存不重复请求', async () => {
  calls.length = 0;
  rects = [
    { id: 'map-item-a1', top: 100, bottom: 200 },
    { id: 'map-item-a2', top: 1200, bottom: 1300 }, // 远离视口
  ];
  const page = makePage([
    { id: 'a1', mapReady: false, mapCenter: { latitude: 30, longitude: 120 } },
    { id: 'a2', mapReady: false, mapCenter: { latitude: 31, longitude: 121 } },
  ]);
  page.syncVisibleMaps();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls, ['/activities/a1/map-points'], '只拉可视行');
  assert.equal(page.data.items[0].mapReady, true);
  assert.equal(page.data.items[0].mapDetail, true);
  assert.equal(page.data.items[0].mapPolyline.length, 1);
  assert.deepEqual(page.data.items[0].mapCenter, { latitude: 30, longitude: 120 });
  assert.equal(page.data.items[1].mapReady, false, '远处行不挂地图');

  await page.loadItemMap('a1');
  assert.equal(calls.length, 1, '已加载过的不再请求');

  await new Promise((r) => setTimeout(r, 90));
  assert.ok(fits.length > 0, '地图挂载后应主动 includePoints');
  assert.equal(fits[0].id, 'track-map-a1');
  assert.equal(fits[0].opts.points.length, 4, '用包围盒四角适配');
  assert.deepEqual(fits[0].opts.padding, [12, 12, 12, 12]);
});

test('TM1b 滚出视口后卸载地图节点（点数据保留）', () => {
  rects = [{ id: 'map-item-a1', top: 2000, bottom: 2100 }];
  const page = makePage([
    {
      id: 'a1',
      mapReady: true,
      mapCenter: { latitude: 30, longitude: 120 },
      mapPolyline: [{ points: [] }],
    },
  ]);
  page.syncVisibleMaps();
  assert.equal(page.data.items[0].mapReady, false);
  assert.equal(page.data.items[0].mapPolyline.length, 1, '缓存的折线不丢');
});

test('TM2 请求失败：标记降级，不把整行卡死', async () => {
  calls.length = 0;
  const page = makePage([{ id: 'bad', mapReady: false }]);
  await page.loadItemMap('bad');
  assert.equal(page.data.items[0].mapFailed, true);
  assert.equal(page.data.items[0].mapLoading, false);
});

test('TM3 列表装饰：预览折线 + 日期/时段/城市/千卡字段', () => {
  const page = makePage([]);
  const start = new Date(2026, 9, 18, 10, 16).getTime();
  const item = page.decorate(
    {
      _id: 'a1',
      type: 'running',
      startTime: start,
      endTime: start + 3600 * 1000,
      startCity: '德阳市',
      distance: 1200,
      duration: 600,
      calories: 911,
      elevationGain: 89,
      previewPoints: [
        { lat: 30, lng: 120 },
        { lat: 30.1, lng: 120.1 },
      ],
    },
    null,
  );
  assert.equal(item.mapReady, false);
  assert.equal(item.mapDetail, false);
  assert.equal(item.mapPolyline.length, 1, '预览折线立即可用');
  assert.deepEqual(item.mapCenter, { latitude: 30, longitude: 120 });
  assert.equal(item.dateText, '2026/10/18');
  assert.equal(item.timeRangeText, '10:16–11:16');
  assert.equal(item.cityText, '德阳市');
  assert.equal(item.durationText, '0:10:00');
  assert.equal(item.caloriesText, '911');
});

test('TM4 无预览点的轨迹（规划路线等）：不出折线，留给详情请求', () => {
  const page = makePage([]);
  const item = page.decorate(
    {
      _id: 'a2',
      type: 'running',
      startTime: Date.now(),
      distance: 0,
      duration: 0,
      previewPoints: [],
    },
    null,
  );
  assert.equal(item.mapPolyline.length, 0);
  assert.equal(item.mapCenter, null);
});

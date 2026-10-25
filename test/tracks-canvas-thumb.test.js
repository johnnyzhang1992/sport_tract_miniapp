/**
 * 轨迹列表卡片左图：canvas 轨迹缩略图（track-thumb）。
 * 原生地图那一版已抽到 components/track-map-thumb 存档（暂不接入页面），
 * 页面因此不再请求 /activities/:id/map-points，也不保留地图视口控制器。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
/** 注释里的同名字样不算数（曾把注释里的 <map 当实现） */
const stripComments = (s) =>
  s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const apiCalls = [];
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = {
  id: apiPath,
  filename: apiPath,
  loaded: true,
  children: [],
  paths: [],
  exports: {
    get: async (url) => {
      apiCalls.push(url);
      return { items: [], total: 0, monthlyStats: [] };
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

const storageWrites = [];
global.wx = {
  getStorageSync: () => '',
  setStorageSync: (k, v) => storageWrites.push([k, v]),
};
let pageDef = null;
global.Page = (def) => {
  pageDef = def;
};
global.getApp = () => ({ globalData: {}, hasSession: () => false });

require('../miniprogram/pages/tracks/tracks.js');

test('TC1 卡片左图改用 track-thumb：页面 wxml 不再挂原生 map', () => {
  const wxml = stripComments(read('miniprogram/pages/tracks/tracks.wxml'));
  assert.equal((wxml.match(/<track-thumb\b/g) || []).length, 1, '卡片左图应使用 canvas 组件');
  assert.equal((wxml.match(/<map\b/g) || []).length, 0, '原生 map 不应再出现在轨迹页');
  const json = JSON.parse(read('miniprogram/pages/tracks/tracks.json'));
  assert.equal(json.usingComponents['track-thumb'], '/components/track-thumb/track-thumb');
});

test('TC2 页面不再拉 map-points，也不保留地图视口控制器', () => {
  const js = stripComments(read('miniprogram/pages/tracks/tracks.js'));
  assert.ok(!js.includes('map-points'), '不再请求地图详情点');
  assert.ok(!js.includes('createMapContext'), '不再适配地图视野');
  assert.ok(!js.includes('scheduleMapSync'), '不再调度地图挂载');
  assert.ok(!js.includes('map-preview'), '页面不再依赖地图预览工具');
  assert.equal(pageDef.loadItemMap, undefined);
  assert.equal(pageDef.syncVisibleMaps, undefined);
});

test('TC3 装饰项带 canvas 所需字段：预览点 + 深灰蓝线色，且不再塞地图折线', () => {
  const page = Object.create(pageDef);
  const points = [
    { lat: 30, lng: 120 },
    { lat: 30.1, lng: 120.1 },
  ];
  const item = page.decorate(
    {
      _id: 'a1',
      type: 'running',
      startTime: Date.now(),
      distance: 1200,
      duration: 600,
      previewPoints: points,
    },
    null,
  );
  assert.equal(item.color, '#4A5568', '与旧 canvas 缩略图同色');
  assert.deepEqual(item.previewPoints, points);
  assert.ok(!('mapPolyline' in item), '列表项不再携带地图折线');
  assert.ok(!('mapCenter' in item), '列表项不再携带地图中心');
});

test('TC4 卡片/列表模式切换仍记忆选择（不触发地图调度）', () => {
  const page = Object.create(pageDef);
  page.data = { viewMode: 'list' };
  page.setData = (patch) => Object.assign(page.data, patch);
  page.onToggleMode({ currentTarget: { dataset: { mode: 'grid' } } });
  assert.equal(page.data.viewMode, 'grid');
  assert.deepEqual(storageWrites.pop(), ['tracksViewMode', 'grid']);
});

test('TC5 track-thumb 组件本体：2d canvas 绘制，断档/暂停处切段', () => {
  const js = read('miniprogram/components/track-thumb/track-thumb.js');
  assert.ok(js.includes("node.getContext('2d')"), '用 canvas 2d 上下文画线');
  assert.ok(js.includes('splitByUnreliableLinks'), '与详情页共用切段口径');
  assert.ok(js.includes('quadraticCurveTo'), '折线平滑');
  const wxml = read('miniprogram/components/track-thumb/track-thumb.wxml');
  assert.ok(wxml.includes('<canvas type="2d"'));
});

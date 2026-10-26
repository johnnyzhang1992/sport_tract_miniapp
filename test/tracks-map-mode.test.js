/**
 * components/track-map-thumb：轨迹卡片左侧「原生地图」缩略图组件（已存档，列表当前用 canvas）。
 * 视口内才挂 map 并拉详情点；列表预览点先出图；缓存跨实例复用；失败不把整卡降级。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const calls = [];
const normalPoints = [
  { lat: 30, lng: 120 },
  { lat: 31, lng: 121 },
];
let responder = async () => ({ points: normalPoints });
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
      return responder(url);
    },
  },
};

const fits = [];
let observerCb = null;
global.wx = {
  getWindowInfo: () => ({ windowWidth: 375, windowHeight: 753, pixelRatio: 2 }),
  createMapContext: (id) => ({
    includePoints: (opts) => fits.push({ id, opts }),
  }),
};
let def = null;
global.Component = (d) => {
  def = d;
};

require('../miniprogram/components/track-map-thumb/track-map-thumb.js');
assert.ok(def, 'track-map-thumb 应通过 Component() 交出组件定义');

const tick = () => new Promise((r) => setTimeout(r, 0));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 按组件定义拼一个可调用的实例（observers 不自动跑，用例里显式调方法） */
function makeComp(props = {}) {
  const c = {
    data: {
      mounted: false,
      center: null,
      scale: 15,
      polyline: [],
      includePoints: [],
      empty: false,
      failed: false,
      itemId: '',
      previewPoints: [],
      type: '',
      iconImg: '',
    },
    setData(patch, cb) {
      Object.assign(this.data, patch);
      if (typeof cb === 'function') cb();
    },
    triggerEvent(name, detail) {
      this._events = this._events || [];
      this._events.push({ name, detail });
    },
    createIntersectionObserver() {
      return {
        relativeToViewport() {
          return this;
        },
        observe(selector, cb) {
          this._selector = selector;
          observerCb = cb;
          return this;
        },
        disconnect() {},
      };
    },
  };
  Object.assign(c.data, props);
  for (const [k, fn] of Object.entries(def.methods)) c[k] = fn.bind(c);
  return c;
}

test('MM1 列表预览点先出图：中心取包围盒中心，scale 为合法整数档', () => {
  const c = makeComp({
    itemId: 'prev-1',
    type: 'running',
    previewPoints: [
      { lat: 30, lng: 120 },
      { lat: 30.1, lng: 120.1 },
    ],
  });
  c.applyPreview();
  assert.ok(Math.abs(c.data.center.latitude - 30.05) < 1e-9, '起点在包围盒边缘会闪，中心取 bbox 中心');
  assert.ok(Math.abs(c.data.center.longitude - 120.05) < 1e-9);
  assert.ok(Number.isInteger(c.data.scale) && c.data.scale >= 5 && c.data.scale <= 19, `scale=${c.data.scale}`);
  assert.equal(c.data.polyline.length, 1, '预览折线立即可用');
  assert.equal(c.data.mounted, false, '未进入视口不挂 map 节点');
});

test('MM2 进入视口才挂地图并拉详情点；挂载后 includePoints 留 12px', async () => {
  calls.length = 0;
  fits.length = 0;
  responder = async () => ({ points: normalPoints });
  const c = makeComp({
    itemId: 'a1',
    type: 'running',
    previewPoints: [
      { lat: 30, lng: 120 },
      { lat: 30.1, lng: 120.1 },
    ],
  });
  c.applyPreview();
  c.observe();
  assert.equal(calls.length, 0, '未进入视口不请求地图点');

  observerCb({ intersectionRatio: 1 });
  await tick();
  assert.equal(c.data.mounted, true);
  assert.deepEqual(calls, ['/activities/a1/map-points']);
  assert.equal(c.data.polyline.length, 1);
  assert.ok(Math.abs(c.data.center.latitude - 30.5) < 1e-9, '详情点到达后中心随之更新');
  assert.ok(Math.abs(c.data.center.longitude - 120.5) < 1e-9);

  await wait(100);
  assert.ok(fits.length > 0, '地图挂载后应主动 includePoints');
  assert.equal(fits[0].id, 'thumb-map');
  assert.equal(fits[0].opts.points.length, 4, '用包围盒四角适配');
  assert.deepEqual(fits[0].opts.padding, [12, 12, 12, 12]);
});

test('MM3 详情点缓存跨实例复用；离开视口只卸载节点，回来不再请求', async () => {
  calls.length = 0;
  const c = makeComp({ itemId: 'a1', type: 'running' });
  c.applyPreview();
  c.observe();
  observerCb({ intersectionRatio: 1 });
  await tick();
  assert.equal(calls.length, 0, '同一活动已缓存，不再请求');

  observerCb({ intersectionRatio: 0 });
  assert.equal(c.data.mounted, false, '离开视口释放 map 节点');
  observerCb({ intersectionRatio: 1 });
  await tick();
  assert.equal(c.data.mounted, true);
  assert.equal(calls.length, 0, '重新进入视口仍走缓存');
});

test('MM4 详情请求失败：标记失败，但预览地图仍在，不整卡降级', async () => {
  responder = async () => {
    throw new Error('boom');
  };
  const c = makeComp({
    itemId: 'bad-1',
    type: 'running',
    previewPoints: [
      { lat: 30, lng: 120 },
      { lat: 30.1, lng: 120.1 },
    ],
  });
  c.applyPreview();
  c.observe();
  observerCb({ intersectionRatio: 1 });
  await tick();
  assert.equal(c.data.failed, true);
  assert.equal(c.data.mounted, true);
  assert.equal(c.data.polyline.length, 1, '预览折线不因详情失败而清空');
});

test('MM5 无预览点（规划路线等）：进入视口后仍会拉详情点', async () => {
  calls.length = 0;
  responder = async () => ({ points: normalPoints });
  const c = makeComp({ itemId: 'no-preview', type: 'walking' });
  c.applyPreview();
  assert.equal(c.data.center, null);
  c.observe();
  observerCb({ intersectionRatio: 1 });
  await tick();
  assert.deepEqual(calls, ['/activities/no-preview/map-points']);
  assert.ok(c.data.center, '详情点到达后出图');
  assert.equal(c.data.empty, false);
});

test('MM6 详情也没有点：标记空态（暂无轨迹）', async () => {
  responder = async () => ({ points: [] });
  const c = makeComp({ itemId: 'empty-1', type: 'walking' });
  c.applyPreview();
  c.observe();
  observerCb({ intersectionRatio: 1 });
  await tick();
  assert.equal(c.data.empty, true);
  assert.equal(c.data.center, null);
});

test('MM7 点击地图向上抛 tap 事件（导航仍由页面决定）', () => {
  const c = makeComp({ itemId: 'a1' });
  c.onTap();
  assert.deepEqual(c._events, [{ name: 'tap', detail: undefined }]);
});

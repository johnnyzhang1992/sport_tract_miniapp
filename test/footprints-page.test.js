/**
 * 足迹页（pages/footprints/footprints.js）页级回归：本地网格聚合 + 离屏 canvas 自绘小圆簇
 * 由 2026-09-21 簇改造的临时 harness（/tmp/fp-cluster-harness.js）升格入仓，四条原场景保留为 P1~P4，
 * fix 轮 1 的三条交互回归补为 P0/P5/P6（外加 P7 覆盖 loadGeo 的 loading 与 markers 同帧），
 * P5 在 fix 轮 2 追加「scale 回写必须配套回写当前中心」的断言，
 * P8（polish 轮）覆盖相机写序令牌（过期异步回读不得写回）与「问不到中心 → 无相机降级」。
 * P4/P9 在「地图全屏 + 列表/统计独立页」改造后改测详情半屏组件接线与浮层入口跳转（旧 popup/列表形态已下线）。
 * 运行：npm test（node --test 自动发现）；依赖：仅 node 内置模块。
 * 桩：wx / Page / getApp 就地 stub；services/api 用 require.cache 注入假实现（绕开 config/storage 的真实
 *     wx 依赖）；utils/footprint-geo 走真实纯函数。createMapContext 的 initMarkerCluster/addMarkers 被
 *     stub 成抛错——页面若还残留原生聚合调用会立刻炸；getScale/getCenterLocation 由用例控制回读值
 *     （mapCameraCenter 即「相机此刻真实所在的中心」，P5 用它验证 scale 回写配套回写中心；
 *     centerMode='defer' 把回读挂在在途队列里、'fail' 只回失败，配合 flushCenters() 造异步交错的时序）。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const CLUSTER_ID_BASE = 100000; // 与 footprints.js 的 id 分段约定一致

/* ---------------------------------- 环境桩 ---------------------------------- */

const apiCalls = [];
const apiQueries = []; // /geo 第二次参数（筛选/搜索 query）单独记，apiCalls 仍是纯路径供旧断言用
const apiGeo = { items: [], filteredItems: null }; // P7 用：loadAll 时 /geo 返回这批点（带 query 那趟走 filteredItems）
const fakeApi = {
  get(p, query) {
    apiCalls.push(p);
    if (p === '/footprint-records/geo') {
      apiQueries.push(query || {});
      const hasQuery = query && Object.keys(query).length > 0;
      const src = hasQuery && apiGeo.filteredItems ? apiGeo.filteredItems : apiGeo.items;
      return Promise.resolve({ items: src.slice(), total: src.length });
    }
    if (p === '/footprint-records') return Promise.resolve({ items: [], total: 0 });
    return Promise.reject(new Error('unexpected GET ' + p)); // 详情补拉走快路径时不该被调用（P4 断言）
  },
  del() {
    return Promise.resolve({});
  },
};
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };

// 离屏 canvas 出图排成「手动 flush」队列：簇图何时落地由用例决定，好造并发构建的时序
let canvasSeq = 0;
let canvasCalls = 0;
let pendingCanvas = [];
const canvasCtx = {
  beginPath() {},
  arc() {},
  fill() {},
  stroke() {},
  fillText() {},
};

// MapContext.getCenterLocation 回读的「相机当前中心」：用例改这个值即可模拟用户缩放时顺带平移过的视野
const DEFAULT_CAMERA_CENTER = { latitude: 30.245, longitude: 120.145 };
let mapCameraCenter = Object.assign({}, DEFAULT_CAMERA_CENTER);
// 回读形态：'ok' 同步回 mapCameraCenter（默认，多数用例走这条）
//          'defer' 把 success 排进队列由用例放行 —— 造「异步回读还在途时又并进一次手势」的交错
//          'fail'  只回 fail —— 端上问不到中心，页面该走「无相机」降级
let centerMode = 'ok';
let pendingCenter = [];
/** 页面 toast 记录（无匹配结果的提示走 toast，不再在地图上摆浮层文本） */
const toasts = [];
/** 页面调起的 wx.showModal 记录（登录闸门用；用例自己决定用户点了确认还是取消） */
const modals = [];
/** wx storage 桩：底图图层的选择记在这张表里 */
let storage = {};
function resetStorage() { storage = {}; }
/** 相机中心/回读形态都是模块级状态：用完必须还原，否则漏给后面的用例 */
function resetCameraStub() {
  centerMode = 'ok';
  pendingCenter = [];
  mapCameraCenter = Object.assign({}, DEFAULT_CAMERA_CENTER);
}

global.wx = {
  getWindowInfo: () => ({ windowWidth: 393, windowHeight: 851 }),
  getSystemInfoSync: () => ({ windowWidth: 393, windowHeight: 851 }),
  showToast: (o) => toasts.push(o && o.title),
  hideToast() {},
  getStorageSync: (k) => storage[k],
  setStorageSync: (k, v) => { storage[k] = v; },
  showModal: (o) => modals.push(o),
  navigateTo() {},
  previewImage() {},
  createMapContext: () => ({
    getScale() {},
    getCenterLocation: (opts) => {
      if (!opts) return;
      if (centerMode === 'defer') {
        pendingCenter.push(opts);
        return;
      }
      if (centerMode === 'fail') {
        if (opts.fail) opts.fail({ errMsg: 'getCenterLocation:fail' });
        return;
      }
      if (opts.success) opts.success(mapCameraCenter);
    },
    initMarkerCluster: () => { throw new Error('原生聚合已废弃，不得再调用'); },
    addMarkers: () => { throw new Error('原生注入已废弃，不得再调用'); },
  }),
  createOffscreenCanvas: () => ({ getContext: () => canvasCtx }),
  canvasToTempFilePath: ({ success }) => {
    canvasCalls++;
    pendingCanvas.push(success);
  },
};
let pageDef = null;
global.Page = (def) => { pageDef = def; };

/**
 * getApp 桩：登录态由用例控制。默认「已登录」（地图页的绝大多数用例都在测有数据的渲染路径），
 * 登录态相关的用例自己调到游客档。hasSession 单独给（= 本地有 token 的老用户，与 loggedIn 不同轴）。
 */
let loginCalls = 0;
const appStub = {
  globalData: { loggedIn: true },
  hasSession: () => true,
  login() {
    loginCalls++;
    appStub.globalData.loggedIn = true;
    return Promise.resolve({});
  },
};
function resetAppStub(over = {}) {
  loginCalls = 0;
  appStub.globalData.loggedIn = over.loggedIn !== undefined ? over.loggedIn : true;
  appStub.globalData.fpDirty = over.fpDirty === true; // 跨页脏标记：默认干净，别让上一个用例漏过来
  appStub.hasSession = () => (over.hasSession !== undefined ? over.hasSession : true);
}
global.getApp = () => appStub;

require('../miniprogram/pages/footprints/footprints.js');
assert.ok(pageDef, 'footprints.js 应通过 Page() 交出页面对象');

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
  p._seq = 1; // 与 loadAll 之后的序号一致，用例只测 marker 链不测数据新鲜度
  return p;
}

const tick = () => new Promise((r) => setImmediate(r));

/** 放行在途的离屏 canvas 出图请求（真实端上是异步回调，这里由用例决定何时落地） */
function flushCanvas() {
  const q = pendingCanvas;
  pendingCanvas = [];
  q.forEach((done) => done({ tempFilePath: 'wxfile://cluster-' + (++canvasSeq) }));
  return q.length;
}

/** 放图 + 排空 microtask，走完「构建 → canvas 出图 → setData 提交」一整圈 */
async function settle() {
  await tick();
  const n = pendingCanvas.length;
  flushCanvas();
  await tick();
  return n;
}

/** 每次开测前清掉上一例残留的在途出图与计数（不影响已写入的图标缓存） */
function resetCanvasQueue() {
  pendingCanvas = [];
  canvasCalls = 0;
  toasts.length = 0;
  modals.length = 0;
  apiGeo.filteredItems = null; // 别让上一个用例的筛选态数据漏进下一个
  resetAppStub();
}

/** 放行在途的 getCenterLocation 回读（FIFO，各自读放行时刻的 mapCameraCenter） */
function flushCenters() {
  const q = pendingCenter;
  pendingCenter = [];
  q.forEach((o) => { if (o.success) o.success(mapCameraCenter); });
  return q.length;
}

/** 把 setData 的 patch 按序记下来，供「哪一次写了相机属性」断言用；返回 stop 交还原始 setData */
function recordPatches(page) {
  const patches = [];
  const upstream = page.setData;
  page.setData = (patch, cb) => {
    patches.push(patch);
    return upstream(patch, cb);
  };
  return { patches, stop: () => { page.setData = upstream; } };
}

/** 一条经度每隔 0.002° 的 6 点直线：zoom 10 下整列跨约 7px 并成一簇，zoom 20 下相邻两点已隔约 1.5kpx 各自成叶 */
function lineRecords() {
  return Array.from({ length: 6 }, (_, i) => ({ id: 'l' + i, title: '列' + i, visitDate: '2026-09-06', latitude: 30.245, longitude: 120.145 + i * 0.002 }));
}

/* ---------------------------------- 数据集 ---------------------------------- */

/** 杭州西湖 0.02° 见方 65 条（i%8×i%9 格点，坐标互不相同）+ 5 个异地稀疏点 = 70 */
function seventyRecords() {
  const recs = [];
  for (let i = 0; i < 65; i++) {
    recs.push({
      id: 'r' + i,
      title: '密集' + i,
      visitDate: '2026-09-01',
      latitude: 30.2338 + (i % 8) * 0.0025,
      longitude: 120.1512 + (i % 9) * 0.0025,
    });
  }
  [['北京', 39.9087, 116.461], ['上海', 31.2304, 121.4737], ['广州', 23.1291, 111.3], ['成都', 30.5728, 104.0668], ['丽江', 26.8721, 100.2337]]
    .forEach(([city, lat, lng], j) => {
      recs.push({ id: 's' + j, title: '稀疏' + city, visitDate: '2026-08-01', latitude: lat, longitude: lng });
    });
  return recs;
}

/* ---------------------------------- 用例 ---------------------------------- */

/**
 * P0 必须在文件内最先跑：CLUSTER_ICON_CACHE 是模块级常量、测试进程内共享，
 * 一旦 count=2 的图先被别的用例出好，这里就测不到「在途去重」（缓存只能去掉重复出图）。
 */
test('P0 一次构建里同 count 的簇共用一张 canvas 图（30 个「2」字簇 → 1 次出图）', async () => {
  resetCanvasQueue();
  const page = makePage();
  const recs = [];
  for (let j = 0; j < 30; j++) {
    // 每组两条完全同坐标（任何 zoom 都拆不开），组间 0.01° 间隔（zoom 20 下相距数千 px，不会并组）
    const lng = 120.1 + j * 0.01;
    recs.push({ id: 'p' + j + 'a', title: 'A' + j, visitDate: '2026-09-03', latitude: 30.2, longitude: lng });
    recs.push({ id: 'p' + j + 'b', title: 'B' + j, visitDate: '2026-09-03', latitude: 30.2, longitude: lng });
  }
  page.setData({ records: recs });
  page._gridZoom = 20;
  const building = page.buildMarkers({ fit: false });
  assert.equal(canvasCalls, 1, '30 个 count=2 的桶只发一次离屏 canvas 请求');
  assert.equal(pendingCanvas.length, 1);
  await settle();
  await building;
  assert.equal(page._clusters.length, 30, '分桶数正确');
  assert.ok(page._clusters.every((c) => c.count === 2), '每桶 2 条');
  assert.equal(page.data.markers.length, 30);
  assert.ok(page.data.markers.every((m) => m.id >= CLUSTER_ID_BASE), '全是簇气泡');
  assert.equal(new Set(page.data.markers.map((m) => m.iconPath)).size, 1, '同 count 共用同一张 tempFilePath');
  assert.ok(page.data.markers[0].iconPath.startsWith('wxfile://cluster-'), '簇 icon 为 canvas 出图');
});

test('P1 70 条 buildMarkers：桶/叶计数、id 分段、成员守恒、24px 自绘气泡、静默窗口在提交点打', async () => {
  resetCanvasQueue();
  const page = makePage();
  const records = seventyRecords();
  page.setData({ records });
  const building = page.buildMarkers();
  assert.ok(!page._progCamUntil, '出图在途期间不打静默窗口（否则 900ms 会被 await 吃掉一块）');
  await settle();
  await building;

  const markers = page.data.markers;
  const clusters = page._clusters;
  const bucketTotal = clusters.reduce((s, c) => s + c.count, 0);
  const clusterMarkers = markers.filter((m) => m.id >= CLUSTER_ID_BASE);
  const leafMarkers = markers.filter((m) => m.id < CLUSTER_ID_BASE);
  assert.equal(markers.length, clusters.length, 'markers 与桶一一对应');
  assert.equal(bucketTotal, 70, '成员守恒 70');
  assert.ok(clusterMarkers.length >= 1 && leafMarkers.length >= 5, '既有簇也有叶');
  assert.ok(clusterMarkers.every((m) => m.width === 24 && m.height === 24 && /^wxfile:\/\/cluster-/.test(m.iconPath)), '簇 = 24px 自绘气泡 icon');
  const covered = leafMarkers.map((m) => m.id - 1).concat(clusterMarkers.flatMap((m) => clusters[m.id - CLUSTER_ID_BASE].members));
  assert.equal(new Set(covered).size, 70, '每条 record 恰好被一个 marker/簇覆盖');
  assert.ok(page._progCamUntil > Date.now(), 'fit 视野与 markers 同一次提交落地时才起算静默窗口');
  assert.equal(page._gridZoom, page.data.scale, 'fit 之后聚合 zoom 与 data.scale 同源');
});

test('P2 连点簇气泡展开：每次 +2 级且封顶 20，center 落簇心，65 点大簇被拆开', async () => {
  resetCanvasQueue();
  const page = makePage();
  page.setData({ records: seventyRecords() });
  await (async () => { const b = page.buildMarkers(); await settle(); return b; })();

  const scaleStart = page.data.scale;
  let maxCount = Math.max(...page._clusters.map((c) => c.count));
  let taps = 0;
  for (let step = 0; step < 5 && page.data.scale < 20; step++) {
    const cm = page.data.markers.filter((m) => m.id >= CLUSTER_ID_BASE);
    if (!cm.length) break;
    let target = cm[0];
    cm.forEach((m) => { if (page._clusters[m.id - CLUSTER_ID_BASE].count > page._clusters[target.id - CLUSTER_ID_BASE].count) target = m; });
    const clicked = page._clusters[target.id - CLUSTER_ID_BASE];
    const base = page.data.scale;
    page.onMarkerTap({ detail: { markerId: target.id } });
    await settle();
    taps++;
    assert.equal(page.data.scale, Math.min(20, base + 2), '每次展开 = +2 级且封顶 20');
    assert.ok(Math.abs(page.data.center.latitude - clicked.latitude) < 1e-9 && Math.abs(page.data.center.longitude - clicked.longitude) < 1e-9, 'center 移到被点簇心');
    assert.ok(page._progCamUntil > Date.now(), '展开进入程序视野静默窗口');
    maxCount = Math.max(...page._clusters.map((c) => c.count));
  }
  assert.equal(page.data.scale, Math.min(20, scaleStart + 2 * taps));
  assert.ok(maxCount < 65, '连续放大后 65 点大簇被拆开（当前最大簇 ' + maxCount + '）');
  assert.equal(page.data.markers.length, page._clusters.length, '每轮重建 markers 与桶对齐');
});

test('P3 封顶（scale 20）点同坐标「3」字簇 → 成员半屏列出桶内 records', async () => {
  resetCanvasQueue();
  const page = makePage();
  const same = [0, 1, 2].map((i) => ({ id: 'x' + i, title: '同点位' + i, visitDate: '2026-09-02', latitude: 30.245, longitude: 120.145 }));
  page.setData({ records: same });
  page._gridZoom = 20; // 已在 scale 上限
  await (async () => { const b = page.buildMarkers({ fit: false }); await settle(); return b; })();
  assert.equal(page.data.markers.length, 1);
  assert.ok(page.data.markers[0].id >= CLUSTER_ID_BASE, '封顶后仍是 1 个「3」字簇');
  page.onMarkerTap({ detail: { markerId: page.data.markers[0].id } });
  assert.equal(page.data.clusterSheet.visible, true, '封顶点簇 → 成员半屏');
  assert.deepEqual(page.data.clusterSheet.records.map((r) => r.id), ['x0', 'x1', 'x2'], '成员列表 = 桶内 records');
  page.pickClusterMember({ currentTarget: { dataset: { idx: 1 } } });
  assert.equal(page.data.clusterSheet.visible, false, '选行即关表');
});

test('P4 叶 marker 点击 → 详情半屏快路径（轻量 DTO 直接交给组件，页面不二次请求）', async () => {
  const fullLeaf = Object.assign({}, seventyRecords()[65], { location: { city: '北京' }, description: 'd', people: [], photos: [] });
  const page = makePage();
  page.setData({ records: [fullLeaf] });
  apiCalls.length = 0;
  page.onMarkerTap({ detail: { markerId: 1 } });
  await tick();
  assert.equal(page.data.detailVisible, true);
  assert.equal(page.data.detailRecord.id, 's0');
  assert.equal(apiCalls.filter((u) => /^\/footprint-records\/./.test(u)).length, 0, '快路径不补拉详情（补拉由详情组件内部负责）');
});

test('P5 手势缩放配套回写 scale+当前中心：封顶后双指缩小再点簇仍是放大展开，不误弹成员表', async () => {
  resetCanvasQueue();
  const page = makePage();
  const recs = [0, 1, 2].map((i) => ({ id: 'x' + i, title: '同点位' + i, visitDate: '2026-09-02', latitude: 30.245, longitude: 120.145 }));
  [{}, {}, {}, {}].forEach((_, j) => recs.push({ id: 'f' + j, title: '稀疏' + j, visitDate: '2026-09-02', latitude: 30.245 + (j + 1) * 0.5, longitude: 120.145 }));
  page.setData({ records: recs, scale: 16 });
  page._gridZoom = 16;
  await (async () => { const b = page.buildMarkers({ fit: false }); await settle(); return b; })();
  assert.equal(page.data.markers.length, 5, '1 个「3」字簇 + 4 个稀疏叶');

  // 点同坐标簇一路放到封顶：16 → 18 → 20，到顶后再点才该弹成员表
  for (const expect of [18, 20]) {
    const cluster = page.data.markers.find((m) => m.id >= CLUSTER_ID_BASE);
    page.onMarkerTap({ detail: { markerId: cluster.id } });
    await settle();
    assert.equal(page.data.scale, expect, '放大到 ' + expect);
    assert.equal(page.data.clusterSheet.visible, false);
  }
  const capCluster = page.data.markers.find((m) => m.id >= CLUSTER_ID_BASE);
  page.onMarkerTap({ detail: { markerId: capCluster.id } });
  await settle();
  assert.equal(page.data.clusterSheet.visible, true, '封顶点簇 → 成员半屏（预期行为）');
  page.closeClusterSheet();

  // 用户双指缩小回 12 级（顺带把视野平移走了）：静默窗口已过 → regionchange end 回读并配套回写
  const staleCenter = Object.assign({}, page.data.center); // 手势前 data 里那个陈旧中心（= 上一次 expand 的簇心）
  mapCameraCenter = { latitude: 30.9876, longitude: 120.6543 }; // 相机此刻真实所在处（MapContext 回读）
  const { patches, stop: stopRecording } = recordPatches(page);
  page._progCamUntil = 0;
  page.onRegionChange({ type: 'end', detail: { scale: 12 } });
  await settle();
  stopRecording();
  assert.equal(page._gridZoom, 12);
  assert.equal(page.data.scale, 12, '手势缩放必须回写 data.scale');
  // 回归（fix 轮 2）：scale 回写必须与「当前中心」同一次 setData 配套。
  // <map> 的 scale 属性一改就会把相机重置到绑定的 center 上，只写 scale = 手势一结束视野就弹回 staleCenter，
  // 故事件不带 center 时要走 MapContext.getCenterLocation 兜底，把回读到的真实中心一起写回。
  const camPatch = patches.find((x) => x.scale !== undefined);
  assert.ok(camPatch, '应有回写 data.scale 的那次 setData');
  assert.ok(camPatch.center, 'scale 与 center 必须在同一次 setData 里配套回写');
  assert.deepEqual(camPatch.center, { latitude: 30.9876, longitude: 120.6543 }, '写回的是相机当前中心，不是手势前的陈旧值');
  assert.ok(patches.every((x) => x.scale === undefined || x.center), '不得出现只写 scale 的裸回写（会弹回陈旧中心）');
  assert.notEqual(page.data.center.latitude, staleCenter.latitude, 'data.center 已被带离陈旧值');
  assert.equal(patches.filter((x) => x.scale !== undefined).length, 1, '一次手势只提交一次相机回写');

  // 关键回归：此时点簇该继续放大展开，而不是被陈旧的封顶值骗去开成员半屏
  const cluster = page.data.markers.find((m) => m.id >= CLUSTER_ID_BASE);
  assert.ok(cluster, '缩小后同坐标三点仍成簇');
  page.onMarkerTap({ detail: { markerId: cluster.id } });
  await settle();
  assert.equal(page.data.clusterSheet.visible, false, '未封顶不该弹成员表');
  assert.equal(page.data.scale, 14, '点簇 +2 级');
  assert.ok(Math.abs(page.data.center.latitude - 30.245) < 1e-9, '点簇后中心移到簇心（放大语义）');
  resetCameraStub(); // mapCameraCenter 是模块级的，本例把它挪走过；不还原就会漏给后面的用例
});

test('P6 并发构建：records 已换 / 令牌已被取走的过期构建不得覆盖 markers，也不得留下孤儿 _gridZoom', async () => {
  // 两条子用例的过期构建都靠「在途 canvas 出图」卡住提交时机，簇 count 取 200/250：
  // 全文件只有这里点数够多，能保证这两个 count 的图标尚未进 CLUSTER_ICON_CACHE（缓存命中就不会在途）
  // 6a 同一 _seq 下 records 数组身份变了（刷新期间又起一次构建）
  resetCanvasQueue();
  const pageA = makePage();
  const dense = Array.from({ length: 200 }, (_, i) => ({ id: 'a' + i, title: '同' + i, visitDate: '2026-09-04', latitude: 30.245, longitude: 120.145 }));
  const spread = [0, 1, 2].map((i) => ({ id: 'b' + i, title: '散' + i, visitDate: '2026-09-04', latitude: 30.245, longitude: 120.145 + i * 0.05 }));
  pageA._gridZoom = 16;
  pageA.setData({ records: dense });
  const staleBuild = pageA.buildMarkers(); // fit 视野那一路：1 张「200」字图在途，fitted.scale 此刻还没资格生效
  assert.equal(pendingCanvas.length, 1, '过期构建确实卡在出图阶段');
  assert.equal(pageA._gridZoom, 16, '出图在途期间 fit 不得抢跑写 _gridZoom（聚合 zoom 与静默窗口同属提交点）');
  pageA.setData({ records: spread }); // 换一批数据（数组身份不同）
  const freshBuild = pageA.buildMarkers({ fit: false }); // 3 个叶，无出图，立刻提交
  await settle(); // 过期构建的图这时才落地
  await Promise.all([staleBuild, freshBuild]);
  assert.equal(pageA.data.markers.length, 3, '过期构建被丢弃：屏上是后一次（3 叶）');
  assert.ok(pageA.data.markers.every((m) => m.id < CLUSTER_ID_BASE));
  assert.equal(pageA._clusters.length, 3);
  assert.equal(pageA._gridZoom, 16, '被令牌作废的 fit 不留孤儿 _gridZoom：屏上分桶与后续展开判定同源');

  // 6b records 数组身份没变、只是 zoom 变了（两次数值不同的构建）：records/_seq 都拦不住，只有构建令牌能拦
  resetCanvasQueue();
  const pageB = makePage();
  // 250 点同纬度、经度隔 0.0001°：zoom 4 下整列跨 0.28px 落进同一格，zoom 20 下相邻点已隔 74px 各自成格
  const lattice = Array.from({ length: 250 }, (_, i) => ({ id: 'c' + i, title: '点' + i, visitDate: '2026-09-04', latitude: 30.245, longitude: 120.145 + i * 0.0001 }));
  pageB.setData({ records: lattice });
  pageB._gridZoom = 4;
  const wide = pageB.buildMarkers({ fit: false }); // zoom 4：250 点并成 1 个「250」字簇，出图在途
  assert.equal(pendingCanvas.length, 1, '第一次构建确实卡在出图阶段');
  pageB._gridZoom = 20;
  const tight = pageB.buildMarkers({ fit: false }); // zoom 20：250 个叶，无出图，立刻提交
  await settle();
  await Promise.all([wide, tight]);
  assert.equal(pageB.data.markers.length, 250, '同数据两次构建，后一次（当前 zoom 的分桶）胜出');
  assert.ok(pageB.data.markers.every((m) => m.id < CLUSTER_ID_BASE));
  assert.equal(pageB._clusters.length, 250);
});

test('P7 loadAll：markers 与 loading:false 同帧落地', async () => {
  resetCanvasQueue();
  // 300 条同坐标点：分桶只剩 1 个「300」字簇，count 全文件唯一 → 图标必定现出图、构建必定在途，
  // 于是「loadGeo 有没有 return buildMarkers()」就体现在 loadAll 结束那一刻 markers 是否为空
  apiGeo.items = Array.from({ length: 300 }, (_, i) => ({ id: 'g' + i, title: '同处' + i, visitDate: '2026-09-05', latitude: 30.245, longitude: 120.145 }));
  const page = makePage();
  const running = page.loadAll();
  let markersWhenResolved = -1;
  running.then(() => { markersWhenResolved = page.data.markers.length; }); // 探针：loadAll 结束那一刻的屏上 marker 数
  for (let i = 0; i < 10 && page.data.markers.length === 0; i++) {
    await tick();
    flushCanvas();
  }
  await running;
  assert.equal(page.data.loading, false);
  assert.ok(markersWhenResolved > 0, 'loading 收起时 markers 已在（首屏不闪空图；loadGeo 必须 return buildMarkers()）');
  assert.equal(page.data.records.length, 300);
  apiGeo.items = [];
});

test('P8 相机回写：过期异步回读被写序令牌挡掉 / 静默窗口内不写回 / 问不到中心时降级为无相机提交', async () => {
  // 8a 两次手势的中心回读都在途（getCenterLocation 是异步的），只有最后取号那次有权写相机。
  // 数据用 6 点直线：zoom 10/12 都并成 1 个「6」字簇，zoom 20 拆成 6 个叶 —— 层级是否真生效看得见
  resetCanvasQueue();
  resetCameraStub();
  centerMode = 'defer';
  const pageA = makePage();
  pageA.setData({ records: lineRecords(), scale: 10 });
  pageA._gridZoom = 10;
  await (async () => { const b = pageA.buildMarkers({ fit: false }); await settle(); return b; })();
  assert.equal(pageA.data.markers.length, 1, '起始 zoom 10：6 点并成 1 簇');
  const { patches: patchesA, stop: stopA } = recordPatches(pageA);

  pageA._progCamUntil = 0;
  pageA.onRegionChange({ type: 'end', detail: { scale: 8 } }); // 事件不带中心 → 走异步回读（令牌 1）
  assert.equal(pendingCenter.length, 1, '第一次回读确实卡在在途');
  assert.equal(pageA.data.scale, 10, '中心问出来之前不回写 scale');
  pageA.onRegionChange({ type: 'end', detail: { scale: 12 } }); // 更晚的一次手势（令牌 2，此后 1 就是过期回读）
  assert.equal(pendingCenter.length, 2, '第二次回读也在途');
  mapCameraCenter = { latitude: 29.88, longitude: 121.5 };
  flushCenters(); // FIFO：8 级那次先落地，12 级那次随后
  await settle();
  stopA();

  const camPatches = patchesA.filter((x) => x.scale !== undefined);
  // 回归（polish 轮）：commit 里那次 <0.5 复校只挡「层级几乎没变」，8 与 12 差 4 级它拦不住，
  // 次序得由 _camWriteSeq 写序令牌保证——否则过期回读会带着不属于当前视野的 scale+中心把镜头拽走
  assert.equal(camPatches.length, 1, '过期回读被令牌挡掉：交错两次手势只提交一次相机回写');
  assert.equal(camPatches[0].scale, 12, '留下的是一次交错里最后那次手势的层级');
  assert.deepEqual(camPatches[0].center, { latitude: 29.88, longitude: 121.5 }, '配套写回的仍是相机当前中心');
  assert.equal(pageA.data.scale, 12);
  assert.equal(pageA._gridZoom, 12);
  assert.equal(pageA.data.markers.length, 1, 'zoom 12 下 6 点仍一簇（分桶按新层级重建过）');

  // 8b 令牌是最新的，但回读在途期间点簇把相机程序化挪走了（静默窗口未到）：这次回读同样作废
  pageA.onRegionChange({ type: 'end', detail: { scale: 14 } });
  assert.equal(pendingCenter.length, 1, '第三次回读在途');
  pageA._progCamUntil = Date.now() + 900; // 模拟 expandCluster：相机已按簇心放大重设
  const { patches: patchesB, stop: stopB } = recordPatches(pageA);
  flushCenters();
  await settle();
  stopB();
  assert.equal(patchesB.filter((x) => x.scale !== undefined).length, 0, '静默窗口内的回读不写相机');
  assert.equal(pageA.data.scale, 12, '程序化视野不被过期回读覆盖');
  assert.equal(pageA._gridZoom, 12, '连层级都不动：整次提交丢弃');

  // 8c 端上问不到中心（getCenterLocation 只回 fail）：降级为「只同步聚合层级 + 重建分桶，一个相机属性都不写」。
  // 不能裸回写 scale —— scale 一改相机就被重置到绑定的 center 上，而 center 恰恰是这次问不到的值（必弹回旧视野）；
  // fit:false 的 patch 为空，视野原地不动，也就无从弹回
  resetCanvasQueue();
  resetCameraStub();
  centerMode = 'fail';
  const pageC = makePage();
  pageC.setData({ records: lineRecords(), scale: 10 });
  pageC._gridZoom = 10;
  await (async () => { const b = pageC.buildMarkers({ fit: false }); await settle(); return b; })();
  assert.equal(pageC.data.markers.length, 1);
  const { patches: patchesC, stop: stopC } = recordPatches(pageC);
  pageC._progCamUntil = 0;
  pageC.onRegionChange({ type: 'end', detail: { scale: 20 } });
  await settle();
  stopC();
  resetCameraStub();
  assert.equal(pageC._gridZoom, 20, '问不到中心也要把新层级同步进 _gridZoom（否则后续分桶/封顶判定还按 10 级算）');
  assert.ok(patchesC.every((x) => x.scale === undefined && x.center === undefined), '降级路径不得写任何相机属性');
  assert.equal(pageC.data.scale, 10, 'data.scale 原地不动 = 视野不动');
  assert.equal(pageC.data.markers.length, 6, 'markers 仍按新层级重建：zoom 20 下 6 点各自成叶');
  assert.ok(pageC.data.markers.every((m) => m.id < CLUSTER_ID_BASE));
  assert.equal(pageC._clusters.length, 6);
});

/**
 * P9 接线（地图全屏 + 列表/统计独立页改造后，页面侧的契约）：
 * 详情半屏是地图页唯一的记录详情入口（列表/统计各自成页），点「编辑」要关详情、带 DTO 开表单；
 * 保存/删除成功后关弹层并重拉地图数据；左上浮层两个入口分别 navigateTo 列表页与分包统计页。
 */
test('P9 接线：详情编辑转表单 / 保存与删除后重拉 / 新增态 / 列表入口跳转', () => {
  resetCanvasQueue();
  const page = makePage();
  const nav = [];
  const origNavigateTo = global.wx.navigateTo;
  global.wx.navigateTo = (o) => nav.push(o.url);

  page.setData({ detailVisible: true, detailRecord: { id: 'r1', title: '西湖' } });
  page.onDetailEdit({ detail: { id: 'r1', title: '西湖', description: 'd' } });
  assert.equal(page.data.detailVisible, false, '开表单前先关详情');
  assert.equal(page.data.detailRecord, null);
  assert.equal(page.data.formVisible, true);
  assert.equal(page.data.formRecord.id, 'r1');

  const before = page._seq;
  page.onFormSaved();
  assert.equal(page.data.formVisible, false);
  assert.equal(page.data.formRecord, null);
  assert.ok(page._seq > before, 'onFormSaved 应触发 loadAll（请求序号自增）');

  page.setData({ detailVisible: true, detailRecord: { id: 'r1' } });
  const beforeDel = page._seq;
  page.onDetailDeleted();
  assert.equal(page.data.detailVisible, false, '删除成功后关详情');
  assert.equal(page.data.detailRecord, null);
  assert.ok(page._seq > beforeDel, '删除成功后应重拉地图数据');

  page.openAdd();
  assert.equal(page.data.formVisible, true, '地图页 FAB 仍是唯一的新增入口');
  assert.equal(page.data.formRecord, null);
  page.closeForm();
  assert.equal(page.data.formVisible, false);

  page.goList();
  assert.deepEqual(nav, ['/pages/footprint-list/footprint-list'], '地图页只剩「列表」一个跳转入口（统计收进列表页顶部栏）');
  global.wx.navigateTo = origNavigateTo;
});

/**
 * P10（2026-09-22 改版）：地图页浮层只留筛选，统计与刷新入口整体移除。
 * 页面不能再挂 goStats/onRefreshTap/refreshSpin——WXML 已无按钮可点，留着就是不可达死代码。
 */
test('P10 统计/刷新入口已移除：页面不再暴露对应 handler 与动画标记', () => {
  assert.equal(typeof pageDef.goStats, 'undefined', '统计入口收进列表页顶部栏，地图页不该再有 goStats');
  assert.equal(typeof pageDef.onRefreshTap, 'undefined', '刷新按钮已移除，数据靠进页与增删改后重拉');
  assert.equal(pageDef.data.refreshSpin, undefined, '旋转动画标记随按钮一起删掉');
});

/* ---------------- 筛选 / 搜索 / 分类打点（2026-09-22 地图页改版） ---------------- */

const GEO_ONE = [
  { id: 'a', title: '西湖', visitDate: '2024-05-01', latitude: 30.2, longitude: 120.1, province: '浙江省', city: '杭州市', category: 'scenic' },
  { id: 'b', title: '灵隐寺', visitDate: '2025-03-02', latitude: 30.21, longitude: 120.11, province: '浙江省', city: '杭州市', category: 'heritage' },
  { id: 'c', title: '老屋', visitDate: '2025-06-06', latitude: 34.3, longitude: 108.9, province: '陕西省', city: '西安市', category: '' },
];

test('P11 筛选确定：三项写进 filter 并按 query 重拉，另拉一次全量算候选，角标计数', async () => {
  resetCanvasQueue();
  apiCalls.length = 0;
  apiQueries.length = 0;
  apiGeo.items = GEO_ONE.map((x) => Object.assign({}, x));
  const page = makePage();
  await page.loadAll();
  assert.deepEqual(apiQueries, [{}], '无筛选时 /geo 不带参数、也不多拉');
  assert.deepEqual(page.data.options.provinces.map((p) => p.name), ['浙江省', '陕西省']);
  assert.deepEqual(page.data.options.years.map((y) => y.year), [2025, 2024]);
  assert.deepEqual(page.data.options.categories.map((c) => c.key), ['scenic', 'heritage'], '分类候选按 config 顺序、未分类不计入');

  apiQueries.length = 0;
  page.onFilterConfirm({ detail: { province: '浙江省', year: '2024', category: 'scenic' } });
  await settle();
  await settle();
  assert.equal(page.data.filterVisible, false, '确定即收起半屏');
  assert.deepEqual(page.data.filter, { province: '浙江省', year: '2024', category: 'scenic' });
  assert.equal(page.data.filterCount, 3, '三项生效 → 按钮角标 3');
  assert.equal(apiQueries.length, 2, '筛选态要额外拉一次全量：候选必须来自未过滤快照，否则选中的省份会从候选里消失');
  assert.deepEqual(apiQueries[0], { province: '浙江省', year: '2024', category: 'scenic' });
  assert.deepEqual(apiQueries[1], {});
  assert.equal(page.data.options.provinces.length, 2, '候选仍是全量口径');
  apiGeo.items = [];
});

test('P13 搜索双态：打字不发请求，回车才生效且同词不重拉，✕ 清空并收起', async () => {
  resetCanvasQueue();
  apiGeo.items = GEO_ONE.map((x) => Object.assign({}, x));
  const page = makePage();
  await page.loadAll();
  page.toggleSearch();
  assert.equal(page.data.searchOpen, true, '点搜索即展开输入框');
  assert.equal(page.data.searchFocus, true);
  apiQueries.length = 0;
  page.onKeywordInput({ detail: { value: ' 灵隐 ' } });
  assert.equal(page.data.keywordInput, ' 灵隐 ');
  assert.equal(apiQueries.length, 0, '只改框内值，未提交不发请求（与列表页同一套双态）');

  page.onSearchConfirm();
  await settle();
  await settle();
  assert.equal(page.data.keyword, '灵隐', '提交时去首尾空格');
  assert.deepEqual(apiQueries[0], { keyword: '灵隐' });

  apiQueries.length = 0;
  page.onSearchConfirm();
  await settle();
  assert.equal(apiQueries.length, 0, '同一个词再回车不重复请求');

  apiQueries.length = 0;
  page.onClearKeyword();
  await settle();
  await settle();
  assert.equal(page.data.keyword, '');
  assert.equal(page.data.keywordInput, '');
  assert.deepEqual(apiQueries[0], {}, '清空后回到全量口径');
  assert.equal(page.data.searchOpen, false, '✕ 顺手把输入框收回去（不必再点一次放大镜）');
  assert.equal(page.data.searchFocus, false, '同时失焦，键盘收起');

  // 框里没字时点 ✕：没东西可清，但收起这个动作必须仍然生效（旧实现在这里直接 return 了）
  page.toggleSearch();
  assert.equal(page.data.searchOpen, true);
  page.onClearKeyword();
  assert.equal(page.data.searchOpen, false, '空框点 ✕ 也能收起');
  apiGeo.items = [];
});

/**
 * P15 无匹配结果改走 toast：地图上不摆浮层文本（用户明确要求），且提示要具体到「搜的词 / 筛选」。
 * 三条边界：带关键词点名该词、只有筛选说筛选、账号真没数据不弹（那是引导不是"没匹配"）。
 */
test('P15 无匹配只弹 toast：带词点名并截断超长、只有筛选说筛选、真无数据不弹', async () => {
  resetCanvasQueue();
  apiGeo.items = [];

  const page = makePage();
  page.setData({ keyword: '灵隐寺' });
  await page.loadAll();
  await settle();
  assert.deepEqual(toasts, ['没有匹配「灵隐寺」的足迹'], '搜索无命中 → toast 带上实际关键词');
  assert.equal(page.data.records.length, 0, '数据仍是空集（地图不出点，不靠浮层说明）');

  // 超长关键词截断：toast 标题两行就顶到地图标题栏了
  toasts.length = 0;
  const long = makePage();
  long.setData({ keyword: '一二三四五六七八九十还超长的词' });
  await long.loadAll();
  await settle();
  assert.deepEqual(toasts, ['没有匹配「一二三四五六七八九十…」的足迹'], '超 10 字截断加省略号');

  // 只有筛选生效（无关键词）
  toasts.length = 0;
  const filtered = makePage();
  filtered.setData({ filter: { province: '西藏自治区', year: '2022', category: '' } });
  await filtered.loadAll();
  await settle();
  assert.deepEqual(toasts, ['没有符合当前筛选的足迹']);

  // 真·无数据：不是"没匹配"，不该弹 toast 打扰
  toasts.length = 0;
  const fresh = makePage();
  await fresh.loadAll();
  await settle();
  assert.deepEqual(toasts, [], '无筛选无关键词的空白账号不弹 toast（保留地图上的新增引导）');
  apiGeo.items = [];
});

test('P14 单点 marker 用分类图标（白圆底），未分类仍走灰色圆点', async () => {
  resetCanvasQueue();
  apiGeo.items = [Object.assign({}, GEO_ONE[0])];
  const page = makePage();
  await page.loadAll();
  await settle();
  await settle();
  const leaf = page.data.markers.find((m) => m.id === 1);
  assert.ok(leaf, '单点应出一个叶 marker');
  assert.equal(leaf.iconPath, '/assets/icons/fp-cat-scenic-chip.png');
  assert.equal(leaf.width, 26);

  apiGeo.items = [Object.assign({}, GEO_ONE[2])]; // category ''
  const page2 = makePage();
  await page2.loadAll();
  await settle();
  await settle();
  const dot = page2.data.markers.find((m) => m.id === 1);
  assert.equal(dot.iconPath, '/assets/icons/marker-dot.png', '未分类保持原圆点，不硬塞「其他」图标');
  apiGeo.items = [];
});

/* ---------------- 图层切换（2026-09-23：标准 ⇄ 卫星，选择记本地） ---------------- */

/** 与 footprints.js 的 MAP_LAYER_KEY 同 CLUSTER_ID_BASE 的约定：测试侧写死，页内改名就该红 */
const MAP_LAYER_KEY = 'footprint_map_layer';

test('P16 图层切换只翻 mapType：一次 setData、写进本地，不重拉数据也不动 markers', () => {
  resetCanvasQueue();
  resetStorage();
  const page = makePage();
  const markers = ['keep-me']; // 哨兵：切底图期间 markers 必须原地不动（连数组身份都不换）
  page.setData({ markers });
  const seqBefore = page._seq;
  const callsBefore = apiCalls.length;
  const { patches, stop } = recordPatches(page);

  page.toggleLayer();
  stop();
  assert.equal(page.data.mapType, 'satellite');
  assert.equal(storage[MAP_LAYER_KEY], 'satellite', '切换要记住，下次进页仍是这档');
  assert.deepEqual(patches, [{ mapType: 'satellite' }], '切底图不该捎带写相机/清 markers/置 loading（会闪屏）');
  assert.equal(page.data.markers, markers, 'markers 身份不变');
  assert.equal(page._seq, seqBefore, '不重拉 /geo：切的是底图不是数据');
  assert.equal(apiCalls.length, callsBefore);

  const back = recordPatches(page);
  page.toggleLayer();
  back.stop();
  assert.equal(page.data.mapType, 'standard');
  assert.equal(storage[MAP_LAYER_KEY], 'standard', '切回标准也要覆盖存值');
});

test('P17 进页读回上次图层：存过卫星即开卫星；没存过/读写炸了都回落标准且不拖垮进页', () => {
  resetCanvasQueue();
  resetStorage();
  storage[MAP_LAYER_KEY] = 'satellite';
  const page = makePage();
  page.onLoad();
  assert.equal(page.data.mapType, 'satellite', 'onLoad 要在首帧渲染前把图层读回来（否则先闪一帧标准图）');

  resetStorage();
  const fresh = makePage();
  fresh.onLoad();
  assert.equal(fresh.data.mapType, 'standard', '没存过 → 默认标准图');

  const origGet = global.wx.getStorageSync;
  global.wx.getStorageSync = () => { throw new Error('storage destroyed'); };
  const broken = makePage();
  assert.doesNotThrow(() => broken.onLoad(), '读 storage 炸了不能把进页一起拖垮');
  assert.equal(broken.data.mapType, 'standard');
  global.wx.getStorageSync = origGet;

  const origSet = global.wx.setStorageSync;
  global.wx.setStorageSync = () => { throw new Error('quota exceeded'); };
  const writer = makePage();
  writer.onLoad();
  assert.doesNotThrow(() => writer.toggleLayer(), '写失败只是下次回默认档，不该打断本次切换');
  assert.equal(writer.data.mapType, 'satellite');
  global.wx.setStorageSync = origSet;

  resetStorage();
});

test('P18 POI 标注开关（左下角「标志」）：默认关，点一下翻转且只翻这一项，不落盘不重拉数据', () => {
  resetCanvasQueue();
  resetStorage();
  const page = makePage();
  page.onLoad();
  assert.equal(page.data.enablePoi, false, 'POI 标注默认关闭（与轨迹页口径一致）');

  // 记录 setData 调用，确保切换只翻 enablePoi（别顺手动 markers 触发重绘）
  const patches = [];
  const origSetData = page.setData;
  page.setData = (patch) => { patches.push(patch); return origSetData(patch); };

  page.togglePoi();
  assert.equal(page.data.enablePoi, true, '点一下要打开');
  assert.deepEqual(patches, [{ enablePoi: true }], '一次 setData 只翻 enablePoi');
  assert.deepEqual(Object.keys(storage), [], 'POI 开关不持久化，与轨迹页同口径');

  page.togglePoi();
  assert.equal(page.data.enablePoi, false, '再点一下关回去');
});

test('P19 分享：转发文案用未过滤总数（筛选态下不能把筛出的几条说成全部）', async () => {
  resetCanvasQueue();
  resetStorage();
  const mk = (id) => ({ id, title: '足迹' + id, visitDate: '2026-09-05', location: { province: '浙江省', city: '杭州市', name: '西湖' } });
  apiGeo.items = [mk('a'), mk('b'), mk('c')];
  const page = makePage();
  page.onLoad();
  await page.loadAll();

  const msg = page.onShareAppMessage();
  assert.equal(msg.path, '/pages/footprints/footprints', '转发的就是足迹页');
  assert.match(msg.title, /3 条足迹/, `总数 3 条要写进文案：${msg.title}`);

  // 筛选生效：屏上只剩 1 条，但文案仍说 3（那条 query 请求由 filteredItems 桩接管）
  apiGeo.filteredItems = [mk('a')];
  page.setData({ filter: { province: '浙江省', year: '', category: '' } });
  await page.loadAll();
  assert.equal(page.data.records.length, 1, '筛选后屏上只剩 1 条');
  assert.match(page.onShareAppMessage().title, /3 条足迹/, '筛选态下文案要用未过滤快照的总数');
});

test('P20 分享：空白账号的文案不出现 0 条；朋友圈口径同转发', async () => {
  resetCanvasQueue();
  resetStorage();
  apiGeo.items = [];
  const page = makePage();
  page.onLoad();
  await page.loadAll();

  const msg = page.onShareAppMessage();
  assert.doesNotMatch(msg.title, /0 条/, `没记录过就别报数字：${msg.title}`);
  assert.ok(msg.title.length > 0);
  const tl = page.onShareTimeline();
  assert.equal(tl.title, msg.title, '两个入口文案一致');
});

/* ---------------- 登录态闸门（2026-09-23：游客别再撞 401 / 白填一整张表单） ----------------
 * 页面形态选的是「触点级拦截」：页面照常渲染（游客看空地图 + 可点的登录引导），
 * 只有写操作（＋）前才弹窗征得同意。读接口一个都不发——/geo 对游客必 401，
 * 发出去只会把首屏落成整页错误态，而这里该给的是引导。 */

/** 排空「弹窗确认 → login → syncData」这条 promise 链 */
async function drain() {
  for (let i = 0; i < 4; i++) await tick();
}

test('P21 游客进页：一个请求都不发、不是错误态，空地图上给可点的登录引导', async () => {
  resetCanvasQueue();
  resetAppStub({ loggedIn: false, hasSession: false });
  apiCalls.length = 0;
  apiGeo.items = GEO_ONE.map((x) => Object.assign({}, x));

  const page = makePage();
  page.onLoad();
  await tick();
  assert.equal(apiCalls.length, 0, '游客不发 /geo：发出去只会落成整页错误态');
  assert.equal(page.data.notLoggedIn, true);
  assert.equal(page.data.error, '', '游客不是失败态');
  assert.equal(page.data.loading, false, '别停在「加载中…」');
  assert.equal(page.data.records.length, 0);
  assert.equal(page.data.markers.length, 0);
  assert.equal(page.data.totalCount, 0, '分享文案不该说出别人的数字');
  apiGeo.items = [];
});

test('P22 老用户（本地有会话）进页：静默恢复登录后照常拉数据', async () => {
  resetCanvasQueue();
  resetAppStub({ loggedIn: false, hasSession: true });
  apiGeo.items = GEO_ONE.map((x) => Object.assign({}, x));

  const page = makePage();
  page.onLoad();
  await drain();
  await settle();
  assert.equal(loginCalls, 1, '本地有 token 就静默恢复，不让老用户重登一次');
  assert.equal(page.data.notLoggedIn, false);
  assert.ok(apiCalls.includes('/footprint-records/geo'), '恢复登录后照常拉数据');
  assert.equal(page.data.records.length, 3);
  apiGeo.items = [];
});

test('P23 游客点 ＋：弹窗取消 → 不登录、不开表单', async () => {
  resetCanvasQueue();
  resetAppStub({ loggedIn: false, hasSession: false });
  const page = makePage();
  page.openAdd();
  assert.equal(page.data.formVisible, false, '游客不能直接开表单：填完整张表才被告知未登录是 bug');
  assert.equal(modals.length, 1, '先弹窗问一次');
  modals[0].success({ confirm: false });
  await drain();
  assert.equal(loginCalls, 0);
  assert.equal(page.data.formVisible, false);
});

test('P24 游客点 ＋：确认后静默登录、开表单，并在后台把地图数据补上', async () => {
  resetCanvasQueue();
  resetAppStub({ loggedIn: false, hasSession: false });
  apiGeo.items = GEO_ONE.map((x) => Object.assign({}, x));

  const page = makePage();
  page.openAdd();
  modals[0].success({ confirm: true });
  await drain();
  assert.equal(loginCalls, 1);
  assert.equal(page.data.formVisible, true, '登录成功接着把表单打开（用户点 ＋ 的意图要落地）');
  assert.equal(page.data.formRecord, null, '仍是新增态');
  await settle();
  assert.equal(page.data.notLoggedIn, false);
  assert.ok(apiCalls.includes('/footprint-records/geo'), '登录后顺手把游客态缺的地图数据补上');
  assert.equal(page.data.records.length, 3);
  apiGeo.items = [];
});

test('P25 已登录点 ＋：不弹窗，同帧开表单（不绕微任务，交互零延迟）', () => {
  resetCanvasQueue();
  const page = makePage();
  page.openAdd();
  assert.equal(modals.length, 0, '已登录不该再拦一道');
  assert.equal(page.data.formVisible, true, '同帧生效：无需 await');
  assert.equal(page.data.formRecord, null);
});

test('P26 onShow 只在登录态变了才重对齐（tab 页去「我的」登录后切回来要补数据）', async () => {
  resetCanvasQueue();
  resetAppStub({ loggedIn: false, hasSession: false });
  apiGeo.items = GEO_ONE.map((x) => Object.assign({}, x));

  const page = makePage();
  page.onLoad();
  await drain();
  apiCalls.length = 0;
  page.onShow();
  assert.equal(apiCalls.length, 0, '登录态没变就别每次切 tab 都重拉一遍');

  appStub.globalData.loggedIn = true; // 用户去「我的」登录了
  page.onShow();
  await settle();
  assert.ok(apiCalls.includes('/footprint-records/geo'), '从别处登录后切回本页要补数据');
  assert.equal(page.data.notLoggedIn, false);
  assert.equal(page.data.records.length, 3);
  apiGeo.items = [];
});

/* ---------- 增删改的相机口径 + 跨页脏刷新（2026-09-25 用户要求「尽量少变化」） ---------- */
/**
 * loadAll 会走 buildMarkers → geo.fitBounds 覆写 center/scale。用户手动缩放到某个角落再
 * 新增/删除一条，视野被弹回「全部点的 fit」是很跳的；筛选/搜索换的是另一批点，重排才是预期。
 * 所以 fit 要按调用方区分：进页与筛选/搜索重排，增删改与跨页脏刷新只换点。
 */
const camWrites = (patches) => patches.filter((p) => p.center || p.scale).length;

test('P27 增删改只换点不重排视野；进页与换筛选仍按 fit 定视野', async () => {
  resetCanvasQueue();
  apiGeo.items = GEO_ONE.map((x) => Object.assign({}, x));
  const page = makePage();
  const { patches, stop } = recordPatches(page);

  await page.loadAll();
  await settle();
  assert.ok(camWrites(patches) >= 1, '进页要按全部点的 bbox 定一次视野');

  let n = camWrites(patches);
  page.onFormSaved(); // 新增/编辑保存
  await settle();
  await settle();
  assert.equal(camWrites(patches), n, '保存后重拉不该把用户视野弹回 fit 档');

  page.onDetailDeleted(); // 本页详情里删除
  await settle();
  await settle();
  assert.equal(camWrites(patches), n, '删除后同理：被删的点不在屏上时，视野不该跟着变');

  page.onFilterConfirm({ detail: { province: '浙江省' } });
  await settle();
  await settle();
  assert.ok(camWrites(patches) > n, '换筛选＝换一批点，该重排视野');
  stop();
  apiGeo.items = [];
});

test('P28 空地图上首次新增仍要定视野（不然新点根本不在屏上）', async () => {
  resetCanvasQueue();
  apiGeo.items = [];
  const page = makePage();
  await page.loadAll();
  await settle();
  assert.equal(page.data.records.length, 0, '夹具：屏上一个点都没有');

  apiGeo.items = [Object.assign({}, GEO_ONE[0])];
  const { patches, stop } = recordPatches(page);
  page.onFormSaved();
  await settle();
  await settle();
  assert.ok(camWrites(patches) >= 1, '原本没有内容 → 新增后必须 fit，否则用户看不到刚存的点');
  stop();
  apiGeo.items = [];
});

test('P29 列表页删过足迹 → 地图页 onShow 重拉一次且不动视野；消费后复位，再切 tab 不重拉', async () => {
  resetCanvasQueue();
  apiGeo.items = GEO_ONE.map((x) => Object.assign({}, x));
  const page = makePage();
  await page.loadAll();
  await settle();
  page._loginSynced = true; // onLoad 已对齐过登录态

  const { patches, stop } = recordPatches(page);
  apiCalls.length = 0;
  appStub.globalData.fpDirty = true;
  page.onShow();
  await settle();
  await settle();
  assert.ok(apiCalls.includes('/footprint-records/geo'), '别的页改过数据，切回来要补上');
  assert.equal(appStub.globalData.fpDirty, false, '消费即复位，否则每次切 tab 都白拉一遍');
  assert.equal(camWrites(patches), 0, '跨页刷新只换点，别弹视野');

  apiCalls.length = 0;
  page.onShow();
  await settle();
  assert.equal(apiCalls.length, 0, '没新变化就一个请求都不发（保住 P26 的防白跑守卫）');
  stop();
  apiGeo.items = [];
});

test('P30 游客态带着脏标记：不发请求，但标记照样消费掉', async () => {
  resetCanvasQueue();
  resetAppStub({ loggedIn: false, hasSession: false, fpDirty: true });
  const page = makePage();
  page.onLoad();
  await drain();
  apiCalls.length = 0;
  page.onShow();
  await settle();
  assert.equal(apiCalls.length, 0, '/geo 对游客必 401，脏了也没得刷');
  assert.equal(appStub.globalData.fpDirty, false, '标记别留给下一次，否则登录后会莫名多拉一趟');
});

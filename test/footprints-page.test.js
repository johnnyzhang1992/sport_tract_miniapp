/**
 * 足迹页（pages/footprints/footprints.js）页级回归：本地网格聚合 + 离屏 canvas 自绘小圆簇
 * 由 2026-09-21 簇改造的临时 harness（/tmp/fp-cluster-harness.js）升格入仓，四条原场景保留为 P1~P4，
 * fix 轮 1 的三条交互回归补为 P0/P5/P6（外加 P7 覆盖 loadGeo 的 loading 与 markers 同帧）。
 * 运行：npm test（node --test 自动发现）；依赖：仅 node 内置模块。
 * 桩：wx / Page / getApp 就地 stub；services/api 用 require.cache 注入假实现（绕开 config/storage 的真实
 *     wx 依赖）；utils/footprint-geo 走真实纯函数。createMapContext 的 initMarkerCluster/addMarkers 被
 *     stub 成抛错——页面若还残留原生聚合调用会立刻炸。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CLUSTER_ID_BASE = 100000; // 与 footprints.js 的 id 分段约定一致

/* ---------------------------------- 环境桩 ---------------------------------- */

const apiCalls = [];
const apiGeo = { items: [] }; // P7 用：loadAll 时 /geo 返回这批点
const fakeApi = {
  get(p) {
    apiCalls.push(p);
    if (p === '/footprint-records/geo') return Promise.resolve({ items: apiGeo.items.slice(), total: apiGeo.items.length });
    if (p === '/footprint-records') return Promise.resolve({ items: [], total: 0 });
    return Promise.reject(new Error('unexpected GET ' + p)); // 详情补拉走快路径时不该被调用（P4 断言）
  },
  del() {
    return Promise.resolve({});
  },
};
const apiPath = require.resolve(path.join(ROOT, 'miniprogram/services/api.js'));
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

global.wx = {
  getWindowInfo: () => ({ windowWidth: 393, windowHeight: 851 }),
  getSystemInfoSync: () => ({ windowWidth: 393, windowHeight: 851 }),
  showToast() {},
  hideToast() {},
  showModal() {},
  navigateTo() {},
  previewImage() {},
  createMapContext: () => ({
    getScale() {},
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
global.getApp = () => ({ globalData: {} });

require(path.join(ROOT, 'miniprogram/pages/footprints/footprints.js'));
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

test('P4 叶 marker 点击 → openPopup 快路径（完整 DTO 不二次请求）', async () => {
  const fullLeaf = Object.assign({}, seventyRecords()[65], { location: { city: '北京' }, description: 'd', people: [], photos: [] });
  const page = makePage();
  page.setData({ records: [fullLeaf] });
  apiCalls.length = 0;
  page.onMarkerTap({ detail: { markerId: 1 } });
  await tick();
  assert.equal(page.data.popup.visible, true);
  assert.equal(page.data.popup.record.id, 's0');
  assert.equal(apiCalls.filter((u) => /^\/footprint-records\/./.test(u)).length, 0, '快路径不补拉详情');
});

test('P5 手势缩放回写 data.scale：封顶后双指缩小再点簇仍是放大展开，不误弹成员表', async () => {
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

  // 用户双指缩小回 12 级：静默窗口已过 → regionchange end 回读并回写 data.scale
  page._progCamUntil = 0;
  page.onRegionChange({ type: 'end', detail: { scale: 12 } });
  await settle();
  assert.equal(page._gridZoom, 12);
  assert.equal(page.data.scale, 12, '手势缩放必须回写 data.scale（相机已在此层级，setData 不会再移动视野）');

  // 关键回归：此时点簇该继续放大展开，而不是被陈旧的封顶值骗去开成员半屏
  const cluster = page.data.markers.find((m) => m.id >= CLUSTER_ID_BASE);
  assert.ok(cluster, '缩小后同坐标三点仍成簇');
  page.onMarkerTap({ detail: { markerId: cluster.id } });
  await settle();
  assert.equal(page.data.clusterSheet.visible, false, '未封顶不该弹成员表');
  assert.equal(page.data.scale, 14, '点簇 +2 级');
});

test('P6 并发构建：records 已换 / 令牌已被取走的过期构建不得覆盖 markers', async () => {
  // 两条子用例的过期构建都靠「在途 canvas 出图」卡住提交时机，簇 count 取 200/250：
  // 全文件只有这里点数够多，能保证这两个 count 的图标尚未进 CLUSTER_ICON_CACHE（缓存命中就不会在途）
  // 6a 同一 _seq 下 records 数组身份变了（刷新期间又起一次构建）
  resetCanvasQueue();
  const pageA = makePage();
  const dense = Array.from({ length: 200 }, (_, i) => ({ id: 'a' + i, title: '同' + i, visitDate: '2026-09-04', latitude: 30.245, longitude: 120.145 }));
  const spread = [0, 1, 2].map((i) => ({ id: 'b' + i, title: '散' + i, visitDate: '2026-09-04', latitude: 30.245, longitude: 120.145 + i * 0.05 }));
  pageA._gridZoom = 16;
  pageA.setData({ records: dense });
  const staleBuild = pageA.buildMarkers({ fit: false }); // 1 张「200」字图在途
  assert.equal(pendingCanvas.length, 1, '过期构建确实卡在出图阶段');
  pageA.setData({ records: spread }); // 换一批数据（数组身份不同）
  const freshBuild = pageA.buildMarkers({ fit: false }); // 3 个叶，无出图，立刻提交
  await settle(); // 过期构建的图这时才落地
  await Promise.all([staleBuild, freshBuild]);
  assert.equal(pageA.data.markers.length, 3, '过期构建被丢弃：屏上是后一次（3 叶）');
  assert.ok(pageA.data.markers.every((m) => m.id < CLUSTER_ID_BASE));
  assert.equal(pageA._clusters.length, 3);

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

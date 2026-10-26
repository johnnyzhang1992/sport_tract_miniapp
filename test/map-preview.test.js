/**
 * 轨迹列表地图缩略图：抽稀点 → 微信 map 组件的 polyline/include-points。
 * 暂停/采样断档点必须切开折线，不能把断档连成一条假线。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildMapView } = require('../miniprogram/utils/map-preview.js');

test('MV1 普通轨迹：一条折线 + 全部点用于自适应视野', () => {
  const view = buildMapView([
    { lat: 30.1, lng: 120.1 },
    { lat: 30.2, lng: 120.2 },
    { lat: 30.3, lng: 120.3 },
  ]);
  assert.ok(view);
  assert.equal(view.polyline.length, 1);
  assert.deepEqual(view.polyline[0].points[0], { latitude: 30.1, longitude: 120.1 });
  assert.equal(view.polyline[0].points.length, 3);
  assert.equal(view.includePoints.length, 4, '四角留白包围盒');
  const lats = view.includePoints.map((p) => p.latitude);
  const lngs = view.includePoints.map((p) => p.longitude);
  assert.ok(Math.min(...lats) < 30.1, '上方留白');
  assert.ok(Math.max(...lats) > 30.3, '下方留白');
  assert.ok(Math.min(...lngs) < 120.1, '左侧留白');
  assert.ok(Math.max(...lngs) > 120.3, '右侧留白');
  assert.ok(Math.abs(view.center.latitude - 30.2) < 1e-9, '中心取包围盒中心（起点在边缘会闪）');
  assert.ok(Math.abs(view.center.longitude - 120.2) < 1e-9);
  assert.equal(view.fitPoints.length, 4, '紧贴合包围盒（供 includePoints 留白用）');
  const fitLats = view.fitPoints.map((p) => p.latitude);
  assert.equal(Math.min(...fitLats), 30.1, 'fitPoints 不再额外内缩');
  assert.equal(Math.max(...fitLats), 30.3);
  // scale 预算：0.2° 跨度 + 留白，110×85px 容器 → 约 8~9 档；合法区间 + 整数档
  // （渲染层折线抽稀按整数档查 maxSimplifyZoom，小数 scale 会在渲染层抛错）
  assert.ok(Number.isFinite(view.scale) && view.scale >= 5 && view.scale <= 19, `scale=${view.scale}`);
  assert.equal(view.scale, Math.floor(view.scale), '整数档（渲染层要求）');
});

test('MV1b scale 预算：跨度越大 scale 越小；容器越大 scale 越大；极小轨迹顶到上限', () => {
  const small = buildMapView(
    [
      { lat: 30.1, lng: 120.1 },
      { lat: 30.11, lng: 120.11 },
    ],
    'walking',
    { width: 110, height: 85 },
  );
  const large = buildMapView(
    [
      { lat: 30, lng: 120 },
      { lat: 30.5, lng: 120.5 },
    ],
    'walking',
    { width: 110, height: 85 },
  );
  assert.ok(small.scale > large.scale, `小轨迹 scale=${small.scale} 应大于大轨迹 ${large.scale}`);
  const bigScreen = buildMapView(
    [
      { lat: 30, lng: 120 },
      { lat: 30.5, lng: 120.5 },
    ],
    'walking',
    { width: 220, height: 170 },
  );
  assert.ok(bigScreen.scale > large.scale, '同轨迹容器翻倍 → scale 更高');
  // 几乎零跨度（原地）：mpp 兜底 1e-6 不产生 NaN/Infinity，且顶到上限
  const stationary = buildMapView(
    [
      { lat: 30.5, lng: 114.4 },
      { lat: 30.5, lng: 114.4 },
    ],
    'walking',
  );
  assert.ok(Number.isFinite(stationary.scale) && stationary.scale <= 19, `scale=${stationary.scale}`);
});

test('MV2 暂停/断档点切开折线，断点本身保留（2026-10-26 起断点另补虚线连接，保持连贯性）', () => {
  const view = buildMapView([
    { lat: 1, lng: 1 },
    { lat: 2, lng: 2, pauseGap: true },
    { lat: 3, lng: 3 },
    { lat: 4, lng: 4, gapJump: true },
    { lat: 5, lng: 5 },
  ]);
  const solid = view.polyline.filter((pl) => !pl.dottedLine);
  const dashed = view.polyline.filter((pl) => pl.dottedLine);
  assert.equal(solid.length, 2, '两段断档 → 两段实线（切开不跨）');
  assert.deepEqual(
    solid[0].points.map((p) => p.latitude),
    [2, 3],
    '暂停点作为新段起点',
  );
  assert.deepEqual(
    solid[1].points.map((p) => p.latitude),
    [4, 5],
  );
  // 断点虚线连接：与详情页同一份连贯性口径，每处断开补一条两点灰虚线
  assert.equal(dashed.length, 2, '两处断开 → 两条虚线连接段');
  for (const pl of dashed) {
    assert.equal(pl.points.length, 2);
    assert.equal(pl.arrowLine, false);
  }
  assert.deepEqual(
    dashed.map((pl) => pl.points[0].latitude).sort(),
    [1, 3],
    '连接段起点 = 前段末点（纬度 1 与 3）',
  );
  assert.equal(view.includePoints.length, 4);
});

test('MV3 空/单点/非法坐标：不出图', () => {
  assert.equal(buildMapView([]), null);
  assert.equal(buildMapView([{ lat: 1, lng: 1 }]), null);
  assert.equal(buildMapView([{ lat: 1, lng: 1 }, { lat: null, lng: 2 }]), null);
  assert.equal(buildMapView(null), null);
});

const { visibleMapIds } = require('../miniprogram/utils/map-preview.js');

test('MV4 可视行判定：视口上下各留 240px 预加载，非 map-item 节点忽略', () => {
  const rects = [
    { id: 'map-item-a', top: 100, bottom: 200 },
    { id: 'map-item-b', top: 660, bottom: 760 }, // 视口 671 + 240 → 可见
    { id: 'map-item-c', top: -200, bottom: -100 }, // 上方预加载区内
    { id: 'map-item-d', top: 1000, bottom: 1100 }, // 太远
    { id: 'other-node', top: 100, bottom: 200 },
  ];
  assert.deepEqual([...visibleMapIds(rects, 671, 240)].sort(), ['a', 'b', 'c']);
});

test('MV5 配速着色：快慢段用不同色档，相邻段首尾相接', () => {
  // walking 绝对刻度 180~600s/km；每段约 111m
  const base = 1700000000000;
  const view = buildMapView(
    [
      { lat: 0, lng: 0, timestamp: base },
      { lat: 0, lng: 0.001, timestamp: base + 30 * 1000 }, // 270s/km（快）
      { lat: 0, lng: 0.002, timestamp: base + 330 * 1000 }, // 2700s/km（慢）
    ],
    'walking',
  );
  assert.ok(view);
  assert.ok(view.polyline.length >= 2, '快慢段应分色');
  const colors = view.polyline.map((p) => p.color);
  assert.ok(colors.includes('#ef4444'), '快段红色');
  assert.ok(colors.includes('#22c55e'), '慢段绿色');
  for (let i = 1; i < view.polyline.length; i++) {
    const prev = view.polyline[i - 1].points;
    const cur = view.polyline[i].points;
    assert.deepEqual(cur[0], prev[prev.length - 1], '相邻色段首尾相接');
  }
});

test('MV6 无时间戳：无法算配速时回退单色蓝线', () => {
  const view = buildMapView([
    { lat: 0, lng: 0 },
    { lat: 0, lng: 1 },
  ]);
  assert.equal(view.polyline.length, 1);
  assert.equal(view.polyline[0].color, '#2B6CF6');
});

const { selectMapEvictions } = require('../miniprogram/utils/map-preview.js');

test('MV7 地图节点保活：未超上限不卸载，短距离来回滚动不重建', () => {
  const seen = new Map([
    ['a', 1],
    ['b', 2],
  ]);
  const evict = selectMapEvictions({
    mounted: new Set(['a', 'b']),
    visible: new Set(['a']),
    seen,
    cap: 12,
  });
  assert.equal(evict.size, 0);
});

test('MV8 超上限：只淘汰最久未见的非可视行，可视行永不卸载', () => {
  const seen = new Map();
  const mounted = new Set();
  for (let i = 0; i < 15; i++) {
    mounted.add(`m${i}`);
    seen.set(`m${i}`, i);
  }
  const visible = new Set(['m14', 'm13']);
  const evict = selectMapEvictions({ mounted, visible, seen, cap: 12 });
  assert.equal(evict.size, 3, '15 张保活 12 张');
  assert.deepEqual([...evict].sort(), ['m0', 'm1', 'm2'], '最久未见的先走');
  assert.ok(!evict.has('m14') && !evict.has('m13'), '可视行不淘汰');
});

test('MV9 可视行比上限还多：也不卸载可视行', () => {
  const seen = new Map();
  const mounted = new Set();
  for (let i = 0; i < 14; i++) {
    mounted.add(`m${i}`);
    seen.set(`m${i}`, i);
  }
  const visible = new Set(mounted); // 全都在视口
  const evict = selectMapEvictions({ mounted, visible, seen, cap: 12 });
  assert.equal(evict.size, 0);
});

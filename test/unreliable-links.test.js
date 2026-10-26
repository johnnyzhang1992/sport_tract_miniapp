/**
 * 断点虚线连接（渲染连贯性）：collectUnreliableLinks 纯逻辑 + map-preview 集成。
 * 口径：points[i] 带 pauseGap/gapJump ⇒ i-1 → i 是断开的那条线，补一条虚线连接段；
 * vehicle 不在内（灰实线语义）；切段结果不参与推导（切段会丢短段，反推会连错）。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  collectUnreliableLinks,
  UNRELIABLE_LINK_COLOR,
  splitByUnreliableLinks,
} = require('../miniprogram/utils/track-pace.js');
const { buildMapView } = require('../miniprogram/utils/map-preview.js');

const P = (lat, lng, extra = {}) => ({ lat, lng, ...extra });

test('U1 pauseGap 点：补一条 prev→cur 连接段，type=pauseGap', () => {
  const links = collectUnreliableLinks([
    P(30.1, 120.1),
    P(30.2, 120.2),
    P(30.3, 120.3, { pauseGap: true }),
  ]);
  assert.equal(links.length, 1);
  assert.deepEqual(links[0].from, { lat: 30.2, lng: 120.2 });
  assert.deepEqual(links[0].to, { lat: 30.3, lng: 120.3 });
  assert.equal(links[0].type, 'pauseGap');
});

test('U2 gapJump 点：type=gapJump', () => {
  const links = collectUnreliableLinks([
    P(30.1, 120.1),
    P(30.2, 120.2, { gapJump: true }),
  ]);
  assert.equal(links.length, 1);
  assert.equal(links[0].type, 'gapJump');
});

test('U3 vehicle 点不是断点：不产生连接段（灰实线语义，与虚线互斥）', () => {
  const links = collectUnreliableLinks([
    P(30.1, 120.1),
    P(30.2, 120.2, { vehicle: true }),
    P(30.3, 120.3, { vehicle: true }),
  ]);
  assert.deepEqual(links, []);
});

test('U4 首点带标记（无前驱）：跳过不连', () => {
  const links = collectUnreliableLinks([
    P(30.1, 120.1, { pauseGap: true }),
    P(30.2, 120.2),
  ]);
  assert.deepEqual(links, []);
});

test('U5 连续两个断点：链式补两条连接段', () => {
  const links = collectUnreliableLinks([
    P(30.1, 120.1),
    P(30.2, 120.2, { pauseGap: true }),
    P(30.3, 120.3, { gapJump: true }),
    P(30.4, 120.4),
  ]);
  assert.equal(links.length, 2);
  assert.deepEqual(links[0].from, { lat: 30.1, lng: 120.1 });
  assert.deepEqual(links[0].to, { lat: 30.2, lng: 120.2 });
  assert.deepEqual(links[1].from, { lat: 30.2, lng: 120.2 });
  assert.deepEqual(links[1].to, { lat: 30.3, lng: 120.3 });
});

test('U6 坐标缺失的断点：跳过不连（渲染端无法画）', () => {
  const links = collectUnreliableLinks([
    P(30.1, 120.1),
    P(null, 120.2, { pauseGap: true }),
    P(30.3, 120.3, { gapJump: true, lat: 30.3, lng: null }),
  ]);
  assert.deepEqual(links, []);
});

test('U7 空/缺入参：返回空数组不抛错', () => {
  assert.deepEqual(collectUnreliableLinks([]), []);
  assert.deepEqual(collectUnreliableLinks(null), []);
  assert.deepEqual(collectUnreliableLinks(undefined), []);
});

test('U8 同时带 pauseGap+gapJump：type 取 pauseGap（暂停优先）', () => {
  const links = collectUnreliableLinks([
    P(30.1, 120.1),
    P(30.2, 120.2, { pauseGap: true, gapJump: true }),
  ]);
  assert.equal(links[0].type, 'pauseGap');
});

test('U9 与切段同口径：切段断开的每处都有对应连接段', () => {
  const pts = [
    P(30.1, 120.1),
    P(30.2, 120.2),
    P(30.3, 120.3, { pauseGap: true }),
    P(30.4, 120.4),
    P(30.5, 120.5, { gapJump: true }),
    P(30.6, 120.6),
  ];
  const segs = splitByUnreliableLinks([pts]);
  const links = collectUnreliableLinks(pts);
  // 切成 3 段 ⇒ 2 个断开处 ⇒ 2 条连接段
  assert.equal(segs.length, 3);
  assert.equal(links.length, 2);
});

test('U10 map-preview 集成：实线在断点切开，另补 dottedLine 连接段', () => {
  const view = buildMapView([
    P(30.1, 120.1),
    P(30.2, 120.2),
    P(30.3, 120.3, { pauseGap: true }),
    P(30.4, 120.4),
    P(30.5, 120.5, { gapJump: true }),
    P(30.6, 120.6),
  ]);
  assert.ok(view, 'buildMapView 应返回结果');
  const solid = view.polyline.filter((pl) => !pl.dottedLine);
  const dashed = view.polyline.filter((pl) => pl.dottedLine);
  // 无时间戳回退单色模式：3 段实线 + 2 条虚线连接
  assert.equal(solid.length, 3);
  assert.equal(dashed.length, 2);
  for (const pl of dashed) {
    assert.equal(pl.points.length, 2);
    assert.equal(pl.color, UNRELIABLE_LINK_COLOR);
    assert.equal(pl.arrowLine, false);
  }
  // 断开处实线不跨：实线段的点都来自同一切段
  assert.equal(solid[0].points.length, 2);
  assert.equal(solid[1].points.length, 2);
  assert.equal(solid[2].points.length, 2);
});

test('U11 map-preview 普通轨迹：不引入任何 dottedLine（回归）', () => {
  const view = buildMapView([
    P(30.1, 120.1),
    P(30.2, 120.2),
    P(30.3, 120.3),
  ]);
  assert.ok(view);
  assert.ok(view.polyline.every((pl) => !pl.dottedLine));
});

test('U12 连接色常量：存在且为非空字符串（渲染端共用同一份）', () => {
  assert.equal(typeof UNRELIABLE_LINK_COLOR, 'string');
  assert.ok(UNRELIABLE_LINK_COLOR.length > 0);
});

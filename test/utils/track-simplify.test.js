const { test } = require('node:test');
const assert = require('node:assert/strict');
const { simplifyForMap } = require('../../miniprogram/utils/track-simplify');

/**
 * 地图展示抽稀单测：保断段标记/首尾点、配额上限、短轨迹零开销。
 */

const ptsWithBreaks = (n, breaks = []) =>
  Array.from({ length: n }, (_, i) => ({
    lat: 30 + i * 0.00001,
    lng: 114,
    altitude: 30 + (i % 7),
    timestamp: i * 2000,
    pauseGap: breaks.includes(i),
    gapJump: false,
  }));

test('超限轨迹：抽到上限内，断段标记与首尾点必保留', () => {
  const pts = ptsWithBreaks(20000, [8000, 15000]);
  const out = simplifyForMap(pts);
  assert.ok(out.length <= 1500);
  assert.equal(out.filter((p) => p.pauseGap || p.gapJump).length, 2, '断段标记点必保留');
  assert.equal(out[0], pts[0], '首点原引用保留');
  assert.equal(out[out.length - 1], pts[pts.length - 1], '尾点原引用保留');
  assert.ok(out.every((p) => p.altitude != null && p.timestamp != null), '保留点字段完整（着色/回放依赖）');
});

test('未超限：原数组原样返回（零开销）', () => {
  const small = [{ lat: 1, lng: 1 }];
  assert.equal(simplifyForMap(small), small);
});

test('自定义上限与保留点字段', () => {
  const pts = ptsWithBreaks(5000);
  const out = simplifyForMap(pts, 100);
  assert.ok(out.length <= 100);
  assert.equal(out[0].lat, pts[0].lat);
});

test('大量断段的极端：每个 run 保底首尾 2 点（允许超上限但受控）', () => {
  // 每 3 点一个断段 → 1000 个 run；极端输入下输出 = runs × 2，仍远小于全量
  const many = Array.from({ length: 3000 }, (_, i) => ({
    lat: i,
    lng: 0,
    pauseGap: i % 3 === 0,
  }));
  const out = simplifyForMap(many, 100);
  assert.ok(out.length <= 2000 + 10, `受控输出，实际 ${out.length}`);
  assert.equal(out.filter((p) => p.pauseGap).length, 1000, '断段点全保留');
});

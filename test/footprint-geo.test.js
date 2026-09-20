/**
 * 足迹地图几何纯计算单元测试（node:test，无 wx 依赖）
 * 运行：node --test test/
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const geo = require('../miniprogram/utils/footprint-geo');

test('墨卡托投影：往返一致，基准点正确', () => {
  [-80, -30, 0, 30.2338, 60, 84].forEach((lat) => {
    const back = geo.worldYToLat(geo.latToWorldY(lat));
    assert.ok(Math.abs(back - lat) < 1e-8, `lat ${lat} -> ${back}`);
  });
  assert.equal(geo.lngToWorldX(0), 128);
  assert.equal(geo.lngToWorldX(-180), 0);
  assert.equal(geo.latToWorldY(0), 128);
  assert.equal(geo.projectLng(90, 3), geo.lngToWorldX(90) * 8); // zoom 每 +1 像素 ×2
  assert.equal(geo.projectLat(30, 0), geo.latToWorldY(30));
});

test('fitBounds 单点：固定 scale 12、center 即该点（防 includePoints 顶满 scale 的老坑）', () => {
  const r = geo.fitBounds([{ latitude: 30.25, longitude: 120.15 }], { width: 393, height: 700 });
  assert.equal(r.scale, geo.FIT_SINGLE_SCALE);
  assert.equal(r.scale, 12);
  assert.equal(r.center.latitude, 30.25);
  assert.equal(r.center.longitude, 120.15);
});

test('fitBounds 零面积包围盒（多点同坐标）：同样固定 scale 12', () => {
  const pts = [
    { latitude: 39.9087, longitude: 116.461 },
    { latitude: 39.9087, longitude: 116.461 },
    { latitude: 39.9087, longitude: 116.461 },
  ];
  const r = geo.fitBounds(pts, { width: 393, height: 700 });
  assert.equal(r.scale, 12);
  assert.equal(r.center.latitude, 39.9087);
});

test('fitBounds 多点：近距点对封顶 15，跨域点对不低于下限 3，center 为包围盒中心', () => {
  const near = geo.fitBounds(
    [
      { latitude: 30.25, longitude: 120.15 },
      { latitude: 30.25001, longitude: 120.15001 },
    ],
    { width: 393, height: 700 },
  );
  assert.equal(near.scale, geo.FIT_MAX_SCALE);
  assert.equal(near.scale, 15);

  const wide = geo.fitBounds(
    [
      { latitude: 4, longitude: 73 },
      { latitude: 53, longitude: 135 },
    ],
    { width: 393, height: 700 },
  );
  assert.equal(wide.scale, geo.MIN_SCALE); // 跨度太大 → 钳到下限 3
  assert.equal(wide.center.longitude, 104);
  assert.ok(wide.center.latitude > 4 && wide.center.latitude < 53);
});

test('gridCluster：同格点并簇，members/recordIndex/簇心均值正确', () => {
  const pts = [
    { index: 0, latitude: 30.25, longitude: 120.15 },
    { index: 1, latitude: 30.2502, longitude: 120.1502 }, // ~28m：低 zoom 下同格
    { index: 2, latitude: 39.9087, longitude: 116.461 }, // 异地孤点
  ];
  const cells = geo.gridCluster(pts, 4);
  assert.equal(cells.length, 2);
  const big = cells.find((c) => c.count === 2);
  assert.deepEqual([...big.members].sort((a, b) => a - b), [0, 1]);
  assert.equal(big.recordIndex, -1);
  assert.equal(big.latitude, (30.25 + 30.2502) / 2);
  assert.equal(big.longitude, (120.15 + 120.1502) / 2);
  const single = cells.find((c) => c.count === 1);
  assert.equal(single.recordIndex, 2);
  assert.deepEqual(single.members, [2]);
});

test('gridCluster：分格对输入顺序稳定（成员归属与簇心不变）', () => {
  const pts = [
    { index: 0, latitude: 30.205, longitude: 120.101 },
    { index: 1, latitude: 30.259, longitude: 120.213 },
    { index: 2, latitude: 30.2338, longitude: 120.1512 },
    { index: 3, latitude: 39.9087, longitude: 116.461 },
  ];
  const keyOf = (c) => c.members.slice().sort((a, b) => a - b).join(',');
  const a = geo.gridCluster(pts, 6);
  const b = geo.gridCluster(pts.slice().reverse(), 6);
  assert.deepEqual(a.map(keyOf).sort(), b.map(keyOf).sort());
  const am = a.map(keyOf).sort().join('|');
  // 同一批点重复构建结果幂等
  assert.equal(am, geo.gridCluster(pts, 6).map(keyOf).sort().join('|'));
});

test('gridCluster：zoom 变大后簇拆成单点格（展开语义）', () => {
  const pts = [
    { index: 0, latitude: 30.205, longitude: 120.101 },
    { index: 1, latitude: 30.259, longitude: 120.213 },
  ];
  const low = geo.gridCluster(pts, 4);
  assert.equal(low.length, 1);
  assert.equal(low[0].count, 2);
  const high = geo.gridCluster(pts, 12);
  assert.equal(high.length, 2);
  assert.ok(high.every((c) => c.count === 1));
});

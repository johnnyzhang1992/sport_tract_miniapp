/**
 * 中短断档速度收紧（gapSpeed 三级阶梯中档）+ 骑行滚动均速天花板（docs/19 §3）
 * 端上实时口径与 tracker.js 现有 vehicle 语义同源：标记步距离不计、时长进 _vehicleMs、
 * restoreFromPoints 重放同口径。运行：node --test test/tracker-midgap.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Tracker } = require('../miniprogram/services/tracker');

const DEG_PER_M = 1 / 111194.9;
/** 步进点：dLat 对应纬度米数 */
const P = (latOffsetM, extra = {}) => ({ latitude: 30 + latOffsetM * DEG_PER_M, longitude: 120, speed: 1, ...extra });

test('T1 步行 60s 断档 400m（6.7m/s > gapSpeed 4）：标 vehicle，不计距离/时长', () => {
  let clock = 0;
  const t = new Tracker('walking', 60, () => clock);
  t.addPoint(P(0));
  clock += 60_000;
  t.addPoint(P(100)); // 100m/60s ≈ 1.67m/s 正常步
  clock += 60_000;
  t.addPoint(P(500)); // 400m/60s ≈ 6.7m/s ∈ (30,120s] 且 > 4 → 收紧标 vehicle
  assert.equal(t.points[2].vehicle, true, '断档落点应标 vehicle');
  assert.ok(t._vehicleMs >= 60_000, `_vehicleMs 应含 60s，实际 ${t._vehicleMs}`);
  assert.ok(t.distance >= 95 && t.distance <= 110, `距离只含正常步 ~100m，实际 ${t.distance}`);
});

test('T2 跑步 45s 断档 250m（5.6m/s < 6.5）：不标，真实穿越隧道保留', () => {
  let clock = 0;
  const t = new Tracker('running', 60, () => clock);
  t.addPoint(P(0));
  clock += 45_000;
  t.addPoint(P(250));
  assert.equal(t.points[1].vehicle, undefined);
  assert.ok(t.distance >= 245, `真实位移应计入，实际 ${t.distance}`);
});

test('T3 pauseGap 恢复首点 + 60s 断档跳变：豁免不标（暂停时长已由 pausedMs 扣过）', () => {
  let clock = 0;
  const t = new Tracker('walking', 60, () => clock);
  t.addPoint(P(0));
  clock += 3000;
  t.addPoint(P(5));
  t.pause();
  clock += 60_000; // 暂停 60s
  t.resume();
  clock += 60_000; // 恢复后 60s 一步跳 400m
  t.addPoint(P(405));
  assert.equal(t.points[2].pauseGap, true, '恢复首点应带 pauseGap');
  assert.equal(t.points[2].vehicle, undefined, 'pauseGap 步不参与收紧（防双扣）');
});

test('T4 restoreFromPoints 重放：vehicle 步距离/时长与实时累计一致', () => {
  let clock = 0;
  const t1 = new Tracker('walking', 60, () => clock);
  t1.addPoint(P(0));
  clock += 60_000;
  t1.addPoint(P(100));
  clock += 60_000;
  t1.addPoint(P(500)); // gapTighten → vehicle
  const t2 = new Tracker('walking', 60, () => clock);
  t2.restoreFromPoints(t1.points, [], t1.startTime, 0, 0);
  assert.equal(Math.round(t2.distance), Math.round(t1.distance), '重放距离应一致');
  assert.equal(t2._vehicleMs, t1._vehicleMs, '重放 _vehicleMs 应一致');
  assert.equal(t2.points[2].vehicle, true, '重放保留 vehicle 标记');
});

test('T5 buildFinalPack 的 pausedMs 口径不受新标记影响（回拨段照旧扣除）', () => {
  let clock = 0;
  const t = new Tracker('walking', 60, () => clock);
  t.addPoint(P(0));
  clock += 3000;
  t.addPoint(P(5));
  clock += 30_000; // 先静止 30s：回拨幅度不能超过已录时长（autoPause 内部 cap）
  t.pause();
  t.autoPause(30_000); // 静止回拨 30s 进 pausedMs
  clock += 60_000;
  t.resume();
  const pack = t.buildFinalPack();
  // pausedMs（含回拨 30s + 暂停 60s）交服务端前要减掉回拨段（服务端按 still 段另扣一次）
  assert.equal(pack.pausedMs, 60_000, `交出去的 pausedMs 应只含真暂停，实际 ${pack.pausedMs}`);
  assert.equal(t.pausedMs, 90_000, '屏幕口径 pausedMs 含回拨段');
});

test('T6 gapTighten 步不进 _recentSpeeds 窗口（中位数不被抬上天）', () => {
  let clock = 0;
  const t = new Tracker('walking', 60, () => clock);
  t.addPoint(P(0));
  clock += 60_000;
  t.addPoint(P(100));
  clock += 60_000;
  t.addPoint(P(500)); // 6.7m/s，标 vehicle → 不入速度窗口
  assert.ok(
    !t._recentSpeeds.some((v) => v > 5),
    `_recentSpeeds 不应含收紧步速度，实际 ${JSON.stringify(t._recentSpeeds)}`,
  );
});

test('T7 骑行滚动窗：5min 均速 15m/s（54km/h）→ 追溯整窗标 vehicle，距离归零', () => {
  let clock = 0;
  const t = new Tracker('cycling', 60, () => clock);
  t.addPoint(P(0));
  // 10 步 × 30s × 450m（15m/s = 54km/h > 12.5 上限）：第 10 步窗口恰好满 300s 即追溯
  for (let k = 1; k <= 10; k++) {
    clock += 30_000;
    t.addPoint(P(k * 450));
  }
  const marked = t.points.filter((p) => p.vehicle).length;
  assert.equal(marked, 10, '窗内全部步应标 vehicle');
  assert.equal(Math.round(t.distance), 0, `窗内距离应全部扣回，实际 ${t.distance}`);
  assert.equal(t._vehicleMs, 300_000, `_vehicleMs 应为 300s，实际 ${t._vehicleMs}`);
  // 清窗重开：后续正常步不重复判定，新距离照常入账
  clock += 30_000;
  t.addPoint(P(11 * 450));
  clock += 30_000;
  t.addPoint(P(12 * 450));
  assert.equal(t.points[11].vehicle, undefined);
  assert.equal(t.points[12].vehicle, undefined);
  assert.ok(t.distance > 800 && t.distance < 1000, `清窗后新步照常入账 ~900m，实际 ${t.distance}`);
});

test('T8 骑行长下坡（窗内净海拔降 200m）：豁免不标，距离保留', () => {
  let clock = 0;
  const t = new Tracker('cycling', 60, () => clock);
  t.addPoint(P(0, { altitude: 1000 }));
  for (let k = 1; k <= 12; k++) {
    clock += 30_000;
    t.addPoint(P(k * 450, { altitude: 1000 - k * 20 })); // 每步降 20m，窗内降 ~240m
  }
  assert.equal(t.points.filter((p) => p.vehicle).length, 0, '长下坡应豁免');
  assert.ok(t.distance >= 5000, `下坡距离应保留，实际 ${t.distance}`);
});

test('T9 restoreFromPoints 重放骑行含滚动窗标记的点列：口径一致', () => {
  let clock = 0;
  const t1 = new Tracker('cycling', 60, () => clock);
  t1.addPoint(P(0));
  for (let k = 1; k <= 12; k++) {
    clock += 30_000;
    t1.addPoint(P(k * 450));
  }
  const t2 = new Tracker('cycling', 60, () => clock);
  t2.restoreFromPoints(t1.points, [], t1.startTime, 0, 0);
  assert.equal(Math.round(t2.distance), Math.round(t1.distance), '重放距离一致（vehicle 步跳过）');
  assert.equal(t2._vehicleMs, t1._vehicleMs, '重放 _vehicleMs 一致');
});

test('T11 巨步弦位移闸门：212s 只移 3.9m（室内丢信号原地）→ 不标 vehicle、不扣时长', () => {
  let clock = 0;
  const t = new Tracker('walking', 60, () => clock);
  t.addPoint(P(0));
  clock += 5000;
  t.addPoint(P(7));
  clock += 212_000; // 室内丢失信号 212s，人几乎原地
  t.addPoint(P(11)); // 只移动 4m
  assert.equal(t.points[2].vehicle, undefined, '原地长空窗不得当乘车');
  assert.equal(t._vehicleMs, 0, '不应扣时长');
  assert.ok(t.distance >= 10 && t.distance <= 12, `位移应照常计入，实际 ${t.distance}`);
});

test('T13 巨步弦类型感知：骑行 358s 跨 3805m（38km/h 合法骑行）→ 不标；机动车 20m/s → 标', () => {
  // 用户实测线上轨迹形态：骑行长断档 10.6m/s 属于真实高速骑行（低于 11.5 上限）
  let clock = 0;
  const t = new Tracker('cycling', 60, () => clock);
  t.addPoint(P(0));
  clock += 358_000;
  t.addPoint(P(3805));
  assert.equal(t.points[1].vehicle, undefined, '合法高速骑行不该被当搭车');
  assert.equal(t._vehicleMs, 0);

  // 机动车：300s 跨 6000m = 20m/s > 11.5 上限 → 标
  clock = 0;
  const t2 = new Tracker('cycling', 60, () => clock);
  t2.addPoint(P(0));
  clock += 300_000;
  t2.addPoint(P(6000));
  assert.equal(t2.points[1].vehicle, true, '机动车速度应标');
  assert.ok(t2._vehicleMs >= 300_000);
});

test('T12 巨步弦回归：300s 跨 3000m（真被运载）仍标 vehicle', () => {
  let clock = 0;
  const t = new Tracker('walking', 60, () => clock);
  t.addPoint(P(0));
  clock += 300_000;
  t.addPoint(P(3000)); // 10 m/s
  assert.equal(t.points[1].vehicle, true, '真被运载的长断档仍要标');
  assert.ok(t._vehicleMs >= 300_000, `时长应进 _vehicleMs，实际 ${t._vehicleMs}`);
  assert.ok(t.distance < 10, `该步位移不计入，实际 ${t.distance}`);
});

test('T10 骑行均速未超天花板（12m/s = 43km/h）：不标', () => {
  let clock = 0;
  const t = new Tracker('cycling', 60, () => clock);
  t.addPoint(P(0));
  for (let k = 1; k <= 12; k++) {
    clock += 30_000;
    t.addPoint(P(k * 360)); // 12m/s = 43.2km/h < 12.5
  }
  assert.equal(t.points.filter((p) => p.vehicle).length, 0, '43km/h 骑行是合法速度');
  assert.ok(t.distance >= 3900, `距离应保留，实际 ${t.distance}`);
});

/**
 * tracker 记录器逻辑单元测试（node:test，无 wx 依赖）
 * 运行：node --test test/
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Tracker, haversine } = require('../miniprogram/services/tracker');

const P = (lat, lng, alt) => ({ latitude: lat, longitude: lng, altitude: alt, speed: 1 });

test('Haversine：纬度 0.0001° ≈ 11.1m，且字段兼容两种命名', () => {
  const d = haversine({ latitude: 31.2304, longitude: 121.4737 }, { latitude: 31.2305, longitude: 121.4737 });
  assert.ok(d > 10 && d < 13);
  const d2 = haversine({ lat: 31.2304, lng: 121.4737 }, { latitude: 31.2305, longitude: 121.4737 });
  assert.ok(Math.abs(d2 - d) < 0.01);
});

test('采点：距离累加 + seq 递增', () => {
  let clock = 0;
  const t = new Tracker('running', 60, () => clock);
  t.addPoint(P(31.2304, 121.4737, 10));
  clock += 5000;
  t.addPoint(P(31.2305, 121.4738, 12));
  clock += 5000;
  t.addPoint(P(31.2306, 121.4739, 11));
  assert.ok(t.distance > 25 && t.distance < 40, `distance=${t.distance}`);
  assert.equal(t.seq, 3);
});

test('节流：近距离 + 短时间间隔的点被过滤', () => {
  let clock = 0;
  const t = new Tracker('running', 60, () => clock);
  t.addPoint(P(31.2304, 121.4737, 10));
  clock += 5000;
  t.addPoint(P(31.2305, 121.4738, 12));
  clock += 1;
  const before = t.points.length;
  t.addPoint(P(31.230501, 121.473801, 12)); // ~1.5m，1ms 后
  assert.equal(t.points.length, before);
});

test('漂移过滤：瞬时速度超阈值（>30m/s）的点被过滤', () => {
  let clock = 0;
  const t = new Tracker('running', 60, () => clock);
  t.addPoint(P(31.2304, 121.4737));
  clock += 5000;
  const before = t.points.length;
  clock += 500; // 0.5s
  t.addPoint(P(31.2315, 121.4749)); // ~150m / 0.5s = 300m/s
  assert.equal(t.points.length, before);
});

test('指标：配速/卡路里/爬升死区/最高海拔', () => {
  let clock = 0;
  const t = new Tracker('hiking', 65, () => clock);
  t.addPoint(P(30, 120, 100));
  clock += 5000;
  t.addPoint(P(30.001, 120, 105)); // +5m（间隔 ~111m，> 200m 配速有效）
  clock += 5000;
  t.addPoint(P(30.002, 120, 102)); // -3m 不计
  clock += 5000;
  t.addPoint(P(30.003, 120, 107)); // +5m
  const s = t.getStats();
  assert.equal(s.elevationGain, 10);
  assert.equal(s.maxAltitude, 107);
  assert.ok(s.distance > 300);
  assert.ok(s.calories > 0);
  assert.ok(s.pace !== null, 'hiking 应展示配速');
});

test('配速：距离过短（<200m）不展示（显示 —）', () => {
  let clock = 0;
  const t = new Tracker('running', 60, () => clock);
  t.addPoint(P(30, 120));
  clock += 5000;
  t.addPoint(P(30.0005, 120)); // 约 55m < 200m
  assert.equal(t.getStats().pace, null);
});

test('配速：游泳/骑行返回 null（不展示配速）', () => {
  let clock = 0;
  const t = new Tracker('swimming', 60, () => clock);
  t.addPoint(P(30, 120));
  clock += 5000;
  t.addPoint(P(30.0001, 120));
  assert.equal(t.getStats().pace, null);
});

test('暂停/继续：暂停不采点、时长扣除暂停', () => {
  let clock = 0;
  const t = new Tracker('walking', 60, () => clock);
  t.addPoint(P(30, 120));
  clock += 5000;
  t.pause();
  t.addPoint(P(30.0001, 120)); // 暂停中不采
  assert.equal(t.points.length, 1);
  clock += 10000; // 暂停 10s
  t.resume();
  t.addPoint(P(30.0002, 120));
  clock += 5000;
  const dur = t.getDurationSec();
  assert.ok(Math.abs(dur - 10) < 2, `duration=${dur}`);
});

test('增量协议：getNewPoints 按 seq 过滤', () => {
  let clock = 0;
  const t = new Tracker('cycling', 60, () => clock);
  t.addPoint(P(30, 120));
  clock += 5000;
  t.addPoint(P(30.0001, 120));
  assert.equal(t.getNewPoints(0).length, 2);
  assert.equal(t.getNewPoints(1).length, 1);
  assert.equal(t.getNewPoints(1)[0].seq, 2);
});

test('final 包：完整点集 + 地址 + 体重', () => {
  let clock = 0;
  const t = new Tracker('running', 65, () => clock);
  t.addPoint(P(30, 120));
  clock += 5000;
  t.addPoint(P(30.0001, 120));
  const pack = t.buildFinalPack('起点', '终点');
  assert.equal(pack.trackPoints.length, 2);
  assert.equal(pack.weightKg, 65);
  assert.equal(pack.startAddress, '起点');
  assert.equal(pack.endAddress, '终点');
  assert.ok(pack.endTime > 0);
});

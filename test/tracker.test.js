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

test('指标：配速/卡路里/最高海拔', () => {
  let clock = 0;
  const t = new Tracker('hiking', 65, () => clock);
  // 11 点 × 22m = 220m（> 200m 配速门槛）；缓坡 +0.5m/步 连续爬升 5m
  const alts = [100, 100.4, 100.9, 101.3, 101.9, 102.4, 102.9, 103.4, 103.9, 104.4, 105];
  alts.forEach((alt, i) => {
    t.addPoint(P(30 + i * 0.0002, 120, alt));
    clock += 5000;
  });
  const s = t.getStats();
  assert.ok(s.distance > 200, `距离 ${s.distance}m`);
  assert.equal(s.maxAltitude, 105);
  assert.ok(s.calories > 0);
  assert.ok(s.pace !== null, 'hiking 应展示配速');
});

test('爬升：滞回确认——缓坡累计计入、零均值噪声不计（决策 D16 v2）', () => {
  // 缓坡 +0.5m/步：旧"单步>2m 死区"完全漏计，滞回可持续累计达标（EMA 滞后保留少量未确认）
  let clock = 0;
  const ramp = new Tracker('hiking', 65, () => clock);
  const up = [100, 100.4, 100.9, 101.3, 101.9, 102.4, 102.9, 103.4, 103.9, 104.4, 105];
  up.forEach((alt, i) => {
    ramp.addPoint(P(30 + i * 0.0002, 120, alt));
    clock += 5000;
  });
  const g1 = ramp.getStats().elevationGain;
  assert.ok(g1 >= 2 && g1 <= 5, `缓坡 +5m 应计入大部分，实际 ${g1}`);

  // 零均值锯齿（±5m 交替、净高差 0）：噪声上下抵消，不应累计
  clock = 0;
  const noise = new Tracker('hiking', 65, () => clock);
  const saw = [100, 105, 100, 105, 100, 105, 100, 105, 100, 105, 100];
  saw.forEach((alt, i) => {
    noise.addPoint(P(30 + i * 0.0002, 120, alt));
    clock += 5000;
  });
  assert.equal(noise.getStats().elevationGain, 0, '零均值噪声不应产生爬升');
});

test('爬升：单点大跳（GPS 噪声）不确认', () => {
  let clock = 0;
  const t = new Tracker('hiking', 65, () => clock);
  // +5m 单步跳后立即回落（5m 恰好不触发海拔突变过滤，模拟漏网慢跳）
  const alts = [100, 100.2, 100.4, 105.4, 100.6, 100.8, 101];
  alts.forEach((alt, i) => {
    t.addPoint(P(30 + i * 0.0002, 120, alt));
    clock += 5000;
  });
  assert.ok(t.getStats().elevationGain < 1, `单点大跳不应确认爬升`);
});

test('爬升：暂停恢复点海拔漂移不计入', () => {
  let clock = 0;
  const t = new Tracker('hiking', 65, () => clock);
  [100, 100.5, 101, 101.5].forEach((alt, i) => {
    t.addPoint(P(30 + i * 0.0002, 120, alt));
    clock += 5000;
  });
  t.pause();
  clock += 60000;
  t.resume();
  // 恢复后首个点（pauseGap）：暂停期间漂移 +30m，应重置爬升状态而非计入
  t.addPoint(P(30 + 4 * 0.0002, 120, 131.5));
  clock += 5000;
  t.addPoint(P(30 + 5 * 0.0002, 120, 132));
  clock += 5000;
  t.addPoint(P(30 + 6 * 0.0002, 120, 132.5));
  assert.ok(t.getStats().elevationGain < 1, `暂停漂移不应计入，实际 ${t.getStats().elevationGain}`);
});

test('爬升：restoreFromPoints 重放与实时累计一致', () => {
  let clock = 0;
  const t = new Tracker('hiking', 65, () => clock);
  const alts = [100, 105, 102, 107, 104, 109, 106, 111, 108, 113, 110];
  alts.forEach((alt, i) => {
    t.addPoint(P(30 + i * 0.0002, 120, alt));
    clock += 5000;
  });
  const live = t.getStats().elevationGain;
  const t2 = new Tracker('hiking', 65, () => clock);
  t2.restoreFromPoints(
    t.points.map((p) => ({ seq: p.seq, lat: p.lat, lng: p.lng, altitude: p.altitude, timestamp: p.timestamp, pauseGap: !!p.pauseGap })),
    [],
    clock,
    0,
  );
  assert.equal(t2.getStats().elevationGain, live, `重放 ${t2.getStats().elevationGain} ≠ 实时 ${live}`);
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

test('暂停恢复：首个有效点带 pauseGap 标记（被过滤的点不消耗标记）', () => {
  let clock = 0;
  const t = new Tracker('walking', 60, () => clock);
  t.addPoint(P(30, 120));
  clock += 5000;
  t.pause();
  clock += 10000;
  t.resume();
  // 恢复后第一个点被漂移过滤丢弃（0.5s 瞬移 15km）→ 标记不消耗
  clock += 500;
  t.addPoint(P(30.1, 120.1));
  assert.equal(t.points.length, 1);
  // 下一个正常点应带 pauseGap
  clock += 5000;
  const p = t.addPoint(P(30.0002, 120));
  assert.ok(p.pauseGap === true, '恢复后首个被接受的点应有 pauseGap');
  assert.ok(t.points[t.points.length - 1].pauseGap === true);
  // 后续点不再带标记
  clock += 5000;
  const p2 = t.addPoint(P(30.0003, 120));
  assert.ok(!p2.pauseGap, '后续点不应带 pauseGap');
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

test('精度过滤：accuracy 超阈值（室内/弱信号）的点被丢弃', () => {
  let clock = 0;
  const t = new Tracker('running', 60, () => clock);
  t.addPoint({ latitude: 30, longitude: 120, accuracy: 10, timestamp: 1000 });
  clock += 5000;
  const before = t.points.length;
  t.addPoint({ latitude: 30.0002, longitude: 120, accuracy: 150, timestamp: 6000 }); // 150m 精度，丢弃
  assert.equal(t.points.length, before);
  clock += 5000;
  t.addPoint({ latitude: 30.0004, longitude: 120, accuracy: 15, timestamp: 11000 }); // 15m 精度，接受
  assert.equal(t.points.length, 2);
});

// 保留旧用例（顺序追加，避免重名）
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

test('尖刺回滚：短时高速来回跳的点被剔除（距离回退）', () => {
  let clock = 0;
  const t = new Tracker('running', 60, () => clock);
  // 正常步行点：间隔 5s，位移 ~7m（1.4m/s）
  t.addPoint(P(30, 120)); // t0
  clock += 5000;
  t.addPoint(P(30.00006, 120)); // t5
  clock += 5000;
  t.addPoint(P(30.00012, 120)); // t10（正常）
  const before = t.points.length;
  const distBefore = t.distance;
  // 尖刺：紧跟 p2（1.3s 后）东跳 15m → 11.5m/s
  t.addPoint({ latitude: 30.00012, longitude: 120.00014, timestamp: 11300 });
  // 回跳（1s 后西回 16m → 16m/s）
  t.addPoint({ latitude: 30.00013, longitude: 120, timestamp: 12300 });
  // 尖刺点应被剔除 → 最终点数恢复（3 正常 + 最后回跳点 = 4）
  assert.ok(t.points.length < before + 2, `尖刺应被剔除, points=${t.points.length}`);
  // 距离不应虚增（尖刺的 21m + 20m 不应计入）
  assert.ok(t.distance - distBefore < 15, `距离不应含尖刺虚增, 增量=${(t.distance - distBefore).toFixed(1)}m`);
});

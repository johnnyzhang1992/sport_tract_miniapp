/**
 * 异常点标记保留（决策：检测出的异常点不再整批丢弃，保原始数据供后续处理/渲染）
 * - 超速步：保留坐标并标 vehicle（这一步视为坐车，距离不计入，渲染灰显）
 * - 精度差点：抽稀保留（≥10s 或 ≥30m 才收一个）并标 accBad（弱信号段保渲染连续性）
 * - restoreFromPoints 回放与实时累计同口径（vehicle 步不计距离）
 * 运行：npm test（node --test 自动发现）
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Tracker } = require('../miniprogram/services/tracker');

const DEG_PER_M = 1 / 111194.9;
const P = (lat, lng, extra = {}) => ({ latitude: lat, longitude: lng, speed: 1, ...extra });

test('TA1 超速步保留并标记 vehicle，该步距离不计入', () => {
  let clock = 0;
  const t = new Tracker('walking', 60, () => clock);
  t.addPoint(P(30, 120));
  clock += 3000;
  t.addPoint(P(30.0009, 120)); // ~100m / 3s ≈ 33m/s > walking 12m/s 上限
  clock += 3000;
  t.addPoint(P(30.0009, 120.00003)); // 正常慢步 ~3m
  assert.equal(t.points.length, 3, '超速点不再丢弃');
  assert.equal(t.points[1].vehicle, true, '超速点应标记 vehicle');
  assert.equal(t.points[2].vehicle, undefined);
  assert.ok(t.distance > 0 && t.distance < 10, `distance=${t.distance}（只含正常步）`);
});

test('TA2 精度差点抽稀保留：10s 内的丢、超 10s 的留并标 accBad', () => {
  let clock = 0;
  const t = new Tracker('walking', 60, () => clock);
  t.addPoint(P(30, 120, { accuracy: 10 }));
  clock += 3000;
  t.addPoint(P(30.0001, 120, { accuracy: 100 })); // 3s 后差精度：<10s 且 <30m → 丢
  clock += 3000;
  t.addPoint(P(30.0001, 120, { accuracy: 100 })); // 距上一保留点 6s → 丢
  clock += 6000;
  t.addPoint(P(30.0001, 120, { accuracy: 100 })); // 距上一保留点 12s → 留
  assert.equal(t.points.length, 2, `实际 ${t.points.length}`);
  assert.equal(t.points[1].accBad, true, '保留的差精度点应标 accBad');
  assert.equal(t.points[1].vehicle, undefined);
});

test('TA3 精度差点位移 ≥30m 时即使间隔很短也保留（弱信号移动保轨迹形状）', () => {
  let clock = 0;
  const t = new Tracker('walking', 60, () => clock);
  t.addPoint(P(30, 120, { accuracy: 10 }));
  clock += 3000;
  t.addPoint(P(30.0003, 120, { accuracy: 100 })); // ~33m ≥ 30m
  assert.equal(t.points.length, 2);
  assert.equal(t.points[1].accBad, true);
});

test('TA4 restore 回放：vehicle 步不计入距离，与实时累计同口径', () => {
  let clock = 0;
  const t = new Tracker('walking', 60, () => clock);
  t.addPoint(P(30, 120));
  clock += 3000;
  t.addPoint(P(30.0009, 120)); // 坐车步
  clock += 3000;
  t.addPoint(P(30.0009, 120.00003));
  const t2 = new Tracker('walking', 60, () => clock);
  t2.restoreFromPoints(t.points, [], t.startTime, 0, 0);
  assert.ok(Math.abs(t2.distance - t.distance) < 1, `restore=${t2.distance} live=${t.distance}`);
});

test('TA5 尖刺回滚与坐车标记共存：入步已跳过的距离不重复回退', () => {
  let clock = 0;
  const t = new Tracker('walking', 60, () => clock);
  // 4 个正常步行点（喂满局部速度窗口；坐车步不进窗口，见 tracker.js）
  t.addPoint(P(30, 120));
  clock += 3000;
  t.addPoint(P(30.00003, 120));
  clock += 3000;
  t.addPoint(P(30.00006, 120));
  clock += 3000;
  t.addPoint(P(30.00009, 120));
  const normalDist = t.distance;
  clock += 3000;
  t.addPoint(P(30.00099, 120)); // ~100m/3s 跳出 → vehicle 标记，距离未计入
  clock += 3000;
  t.addPoint(P(30.00009, 120)); // 跳回原位 → 构成尖刺（双向高速 + 大转角）→ 回滚
  assert.equal(t.points.length, 5, '尖刺中继点被回滚');
  assert.ok(Math.abs(t.distance - normalDist) < 1, `distance=${t.distance} normal=${normalDist}`);
  const last = t.points[t.points.length - 1];
  assert.equal(last.vehicle, undefined, '回滚后 a→c 是正常步，标记应清除');
});

test('TA6 暂停恢复后首个点是超速点：保留、标 vehicle 且带走 pauseGap', () => {
  let clock = 0;
  const t = new Tracker('walking', 60, () => clock);
  t.addPoint(P(30, 120));
  clock += 5000;
  t.pause();
  clock += 10000;
  t.resume();
  clock += 500;
  const p = t.addPoint(P(30.1, 120.1)); // 0.5s 瞬移 ~15km → 超速但保留
  assert.equal(t.points.length, 2);
  assert.equal(p.vehicle, true, '超速点保留并标记');
  assert.equal(p.pauseGap, true, '恢复后首个被接受的点带 pauseGap');
  clock += 5000;
  const q = t.addPoint(P(30.1002, 120.1));
  assert.equal(q.pauseGap, undefined, '后续点不再带标记');
});

test('TA7 坐车步时长不计入运动时长（超速 + 隧道弦）', () => {
  let clock = 1_700_000_000_000; // 真实纪元基准（restoreFromPoints 的 startTime||兜底不认 0）
  const t = new Tracker('walking', 60, () => clock);
  t.addPoint(P(30, 120));
  clock += 3000;
  t.addPoint(P(30.0009, 120)); // 超速步：3s
  clock += 180000;
  t.addPoint(P(30.0009, 120.0045)); // 隧道弦：180s 无定位后 ~430m（≈2.4m/s，过位移闸门）
  clock += 3000;
  t.addPoint(P(30.0009, 120.00451)); // 正常步：3s
  // 墙钟 186s − 坐车步（3s + 180s）= 3s
  const dur = t.getDurationSec();
  assert.ok(dur > 1 && dur < 8, `时长=${dur.toFixed(1)}s（应约 3s）`);
  // 回放同口径
  const t2 = new Tracker('walking', 60, () => clock);
  t2.restoreFromPoints(t.points, [], t.startTime, 0, 0);
  assert.ok(Math.abs(t2.getDurationSec() - dur) < 1, `restore 时长=${t2.getDurationSec().toFixed(1)}s`);
});

test('TA8 反转漂移（室内乱跳）抽稀保留并标 accBad', () => {
  let clock = 0;
  const t = new Tracker('walking', 60, () => clock);
  // 两个正常点立方向（向北）
  t.addPoint(P(30, 120));
  clock += 3000;
  t.addPoint(P(30.0001, 120));
  clock += 3000;
  // 原地向南反复弹跳（转角 180°、速度 <2m/s）：10s 内的漂移点被抽稀丢弃
  t.addPoint(P(30.0001 - 4 * DEG_PER_M, 120)); // +3s 丢
  clock += 3000;
  t.addPoint(P(30.0001 - 7 * DEG_PER_M, 120)); // +6s 丢
  clock += 3000;
  t.addPoint(P(30.0001 - 10 * DEG_PER_M, 120)); // +9s 丢
  clock += 3000;
  t.addPoint(P(30.0001 - 13 * DEG_PER_M, 120)); // +12s ≥10s → 保留
  assert.equal(t.points.length, 3, `实际 ${t.points.length}`);
  assert.equal(t.points[2].accBad, true, '保留的漂移点标 accBad');
  // 恢复正常（向前走）后照常逐点采，不再带标记
  clock += 3000;
  const p = t.addPoint(P(30.0001 - 13 * DEG_PER_M + 20 * DEG_PER_M, 120));
  assert.equal(p.accBad, undefined, '恢复正常后的点不带标记');
  assert.equal(t.points.length, 4);
});

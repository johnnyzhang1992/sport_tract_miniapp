/**
 * 三个混合场景的端上行为验证（决策：异常点标记保留，不整批丢弃）：
 * 场景一：步行 + 公交 + 暂停等车 + 地铁 + 步行
 *   - 公交（<43km/h）低于步行上限：端上不标、照常计数（交给服务端持续判据）
 *   - 暂停等车：不采点，恢复后首点带 pauseGap
 *   - 地铁地面段（>43km/h）：端上标 vehicle 保留、距离不计
 *   - 隧道：无定位可采，重现点一步成弦 → 巨步弦规则标 vehicle，距离与时长都不计
 * 场景二：步行 + 骑行 + 步行（同一活动、散步类型）
 *   - 慢速骑行（16km/h）远低于步行上限：端上无法区分，如实断言
 * 场景三：类型不符——选散步实际坐车（>43km/h）
 *   - 全程超速步标记保留、距离不计，坐标一个不丢
 * 运行：npm test（node --test 自动发现）
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Tracker } = require('../miniprogram/services/tracker');

const DEG_PER_M = 1 / 111194.9;

test('场景一：步行+公交+暂停等车+地铁+步行', () => {
  let clock = 0;
  let lat = 30;
  const t = new Tracker('walking', 60, () => clock);
  const step = () => {
    clock += 3000;
    t.addPoint({ latitude: lat, longitude: 114, accuracy: 10, timestamp: clock });
  };
  const run = (n, speedMps) => {
    for (let i = 0; i < n; i++) {
      lat += speedMps * 3 * DEG_PER_M;
      step();
    }
  };

  // A 步行 30s @1.4m/s
  run(10, 1.4);
  const distA = t.distance;
  // B 公交 60s @9m/s（32km/h < 43km/h 上限）
  run(20, 9);
  assert.equal(t.points.filter((p) => p.vehicle).length, 0, '公交低于步行上限，端上不标坐车');
  assert.ok(t.distance - distA > 500, `公交段照常计数（+${(t.distance - distA).toFixed(0)}m）`);
  const distBus = t.distance;
  // C 暂停等车 120s：不采点
  t.pause();
  clock += 120000;
  t.resume();
  // 走进站 3 步 @1.2
  run(3, 1.2);
  const inStation = t.distance - distBus;
  assert.ok(inStation > 5 && inStation < 20, `进站步行计入（${inStation.toFixed(1)}m）`);
  assert.ok(t.points.some((p) => p.pauseGap), '恢复后首个被接受的点带 pauseGap');
  const distStation = t.distance;
  // D 地铁地面段 24s @16m/s（57.6km/h > 上限）→ 全部标记保留、距离不计
  run(8, 16);
  assert.equal(t.points.filter((p) => p.vehicle).length, 8, '地面超速点全部标记保留');
  assert.equal(t.distance, distStation, '坐车段距离不计入');
  // E 隧道 600s 无定位，重现点已前移 5km → 巨步弦标 vehicle，不计距离
  clock += 600000;
  lat += 5000 * DEG_PER_M;
  step();
  assert.equal(t.distance, distStation, '隧道弦标 vehicle，不计距离');
  assert.equal(t.points.filter((p) => p.vehicle).length, 9, '地面段 8 步 + 弦 1 步全部标记保留');
  // F 出站步行 30s @1.4
  run(10, 1.4);

  assert.equal(t.points.length, 10 + 20 + 3 + 8 + 1 + 10, '全程 52 个定位点一个不丢');
  assert.ok(t.distance > 600 && t.distance < 700, `端上距离=${t.distance.toFixed(0)}（步行 42 + 公交 540 + 进站 11 + 出站 42，坐车段与弦已剔）`);
  // 运动时长不含暂停（120s）与坐车步（地面段 24s + 弦 603s），只剩步行+公交+进站
  const dur = t.getDurationSec();
  assert.ok(dur > 115 && dur < 145, `时长=${dur.toFixed(0)}s（应约 129s）`);
});

test('场景二：步行+骑行+步行（同一活动、散步类型）', () => {
  let clock = 0;
  let lat = 30;
  const t = new Tracker('walking', 60, () => clock);
  const run = (n, speedMps) => {
    for (let i = 0; i < n; i++) {
      clock += 3000;
      lat += speedMps * 3 * DEG_PER_M;
      t.addPoint({ latitude: lat, longitude: 114, accuracy: 10, timestamp: clock });
    }
  };
  run(10, 1.4);
  const distWalk1 = t.distance;
  run(15, 4.5); // 16.2km/h 休闲骑行
  const distCycle = t.distance - distWalk1;
  run(10, 1.4);
  assert.equal(t.points.filter((p) => p.vehicle).length, 0, '慢速骑行低于步行上限，端上不标');
  assert.ok(distCycle > 180 && distCycle < 220, `骑行段计入距离（${distCycle.toFixed(0)}m）`);
  assert.equal(t.points.length, 35, '无点被丢弃');
  // 限制如实记录：4.5m/s 与快走靠速度无法区分，只能靠服务端 6.5m/s 持续判据兜较快骑行
});

test('场景三：类型不符——选散步实际坐车（>43km/h）', () => {
  let clock = 0;
  let lat = 30;
  const t = new Tracker('walking', 60, () => clock);
  const run = (n, speedMps) => {
    for (let i = 0; i < n; i++) {
      clock += 3000;
      lat += speedMps * 3 * DEG_PER_M;
      t.addPoint({ latitude: lat, longitude: 114, accuracy: 10, timestamp: clock });
    }
  };
  run(5, 1.4);
  const distWalk1 = t.distance;
  run(30, 15); // 54km/h 全程超速
  assert.ok(t.points.filter((p) => p.vehicle).length >= 30, '坐车段全程标记保留');
  assert.equal(t.distance, distWalk1, '坐车距离不计入');
  run(5, 1.4);
  assert.equal(t.points.length, 40, '40 个定位点一个不丢');
  assert.ok(t.distance > 30 && t.distance < 90, `距离只剩步行部分（${t.distance.toFixed(0)}m）`);
});

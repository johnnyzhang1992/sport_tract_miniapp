/**
 * 录入端实时「疑似乘车」判定单元测试（node:test，无 wx 依赖）
 * 运行：node --test test/vehicle-live.test.js
 * 阈值口径与服务端 sport_track_api/src/utils/vehicle.ts 一致（端上 import 不到后端代码，改一处要改两处）
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createVehicleWatcher, VEHICLE_LIVE_THRESHOLDS } = require('../miniprogram/utils/vehicle-live');

const M_PER_DEG_LAT = (2 * Math.PI * 6371000) / 360;
const T0 = 1700000000000;

/** 造一串点：每步 { sec, speed }，沿经线推进；speed 0 = 原地 */
function walk(steps) {
  let lat = 30;
  let t = T0;
  const pts = [{ lat, lng: 120, timestamp: t }];
  for (const s of steps) {
    lat += (s.speed * s.sec) / M_PER_DEG_LAT;
    t += s.sec * 1000;
    pts.push({ lat, lng: 120, timestamp: t, pauseGap: !!s.pauseGap });
  }
  return pts;
}

/** 逐步喂给 watcher，返回命中次数与每次命中时的均速 */
function feed(w, pts) {
  const hits = [];
  for (let i = 1; i < pts.length; i++) {
    const r = w.step(pts[i - 1], pts[i]);
    if (r) hits.push(r);
  }
  return hits;
}

const fast = (n, sec = 2) => Array.from({ length: n }, () => ({ sec, speed: 8 }));
const slow = (n, sec = 2) => Array.from({ length: n }, () => ({ sec, speed: 0.3 }));

test('连续 60 秒 8m/s：成段那一刻命中一次，之后同段不重复提示', () => {
  const w = createVehicleWatcher('running');
  const hits = feed(w, walk(fast(40))); // 40 步 ×2s = 80s
  assert.equal(hits.length, 1, '每段只提示一次');
  assert.ok(hits[0].runSec >= 60 && hits[0].runSec < 64, `第 60s 前后命中，实际 ${hits[0].runSec}`);
  assert.ok(hits[0].avgMps > 7.5, `均速应≈8m/s，实际 ${hits[0].avgMps}`);
});

test('只有 30 秒高速：不命中（冲坡/过街冲刺不该被打扰）', () => {
  assert.equal(feed(createVehicleWatcher('running'), walk(fast(15))).length, 0);
});

test('穿插 2 个慢步仍算同段；3 个慢步则断开并重新计时', () => {
  const withTwo = feed(createVehicleWatcher('running'), walk([...fast(28), ...slow(2), ...fast(10)]));
  assert.equal(withTwo.length, 1, '28+2+10 步 = 80s 连续（含红绿灯），应命中');
  const withThree = feed(createVehicleWatcher('running'), walk([...fast(28), ...slow(3), ...fast(28)]));
  assert.equal(withThree.length, 0, '3 个慢步说明人又在自己动，两侧各 56s 不足门槛都不该命中');
});

test('断开后再次成段会再提示一次（每段各一次）', () => {
  const w = createVehicleWatcher('running');
  const hits = feed(w, walk([...fast(40), ...slow(6), ...fast(40)]));
  assert.equal(hits.length, 2, '搭车 → 下车跑一段 → 又搭车，应当提示两次');
});

test('骑行/游泳等非人力类型一律不判（6.5m/s 对它们是正常速度）', () => {
  for (const type of ['cycling', 'swimming', 'rowing', 'skiing', undefined]) {
    assert.equal(feed(createVehicleWatcher(type), walk(fast(60))).length, 0, `${type} 不该提示`);
  }
});

test('采样断档与手动暂停处重新计时：不拿"瞬移"凑出 60 秒', () => {
  assert.equal(feed(createVehicleWatcher('running'), walk(fast(20))).length, 0);
  const paused = walk([{ sec: 2, speed: 8, pauseGap: true }, ...fast(60)]);
  assert.equal(feed(createVehicleWatcher('running'), paused).length, 1, 'pauseGap 那一步归零后重新累计');
});

test('阈值与服务端同口径', () => {
  assert.equal(VEHICLE_LIVE_THRESHOLDS.MIN_SPEED_MPS, 6.5);
  assert.equal(VEHICLE_LIVE_THRESHOLDS.MIN_SEC, 60);
  assert.equal(VEHICLE_LIVE_THRESHOLDS.MAX_SLOW_STEPS, 2);
  assert.equal(VEHICLE_LIVE_THRESHOLDS.MIN_STEPS, 5);
  assert.equal(VEHICLE_LIVE_THRESHOLDS.MAX_STEP_SEC, 120);
  assert.deepEqual(
    [...VEHICLE_LIVE_THRESHOLDS.TYPES].sort(),
    ['hiking', 'mountaineering', 'running', 'walking'].sort(),
  );
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStandstillWatcher, STANDSTILL_LIVE_THRESHOLDS } = require('../miniprogram/utils/standstill-live.js');

const BASE = 1790832000000;
const LAT0 = 31.23;
const LNG0 = 121.47;
/** 距起点 distM 米、第 tSec 秒的点（沿纬度方向） */
const P = (distM, tSec) => ({ lat: LAT0 + distM / 111320, lng: LNG0, timestamp: BASE + tSec * 1000 });

function make() {
  const events = { autoPause: 0, pauseStillSec: 0 };
  const watcher = createStandstillWatcher({
    onAutoPause: (info) => { events.autoPause++; events.pauseStillSec = info.stillSec; },
  });
  return { watcher, events };
}

/** 依次喂相邻两点（节点首点由调用方保证与上一步的末点相同） */
function feed(watcher, pts) {
  for (let i = 1; i < pts.length; i++) watcher.step(pts[i - 1], pts[i]);
  return pts[pts.length - 1];
}

/** 原地静止 steps 步：以 baseM 为中心在 [baseM, baseM+jitter] 之间往返（步距 ≤ jitter），每 dt 秒一点 */
function stillFrom(startT, steps, { dt = 30, jitter = 5, baseM = 0 } = {}) {
  const pts = [P(baseM, startT)];
  for (let i = 1; i <= steps; i++) pts.push(P(baseM + (i % 2 === 1 ? jitter : 0), startT + i * dt));
  return pts;
}

/** 匀速直线行进：mps 米/秒、每 stepSec 秒一点、共 totalSec 秒 */
function walkPts(mps, totalSec, stepSec) {
  const pts = [];
  for (let t = 0; t <= totalSec; t += stepSec) pts.push(P(mps * t, t));
  return pts;
}

test('自动暂停线＝静止 5 分钟：整 5 分钟不触发，再多一步才触发', () => {
  const { watcher, events } = make();
  feed(watcher, stillFrom(0, 10)); // 静止 300s
  assert.equal(events.autoPause, 0, '静止整 300s 不算「超过 5 分钟」，不该触发');

  feed(watcher, stillFrom(300, 1)); // 再一步 → 330s
  assert.equal(events.autoPause, 1, '静止 330s > 300s → 触发');
  assert.equal(events.pauseStillSec, 330);
});

test('走路不误判（锚点半径口径）：1.2 m/s 慢走 / 2.4 m/s 跑，各 10 分钟都不触发', () => {
  for (const mps of [1.2, 2.4]) {
    const { watcher, events } = make();
    // 端上节流（3m/3s）后的真实步距：3.6m / 7.2m，每一步都小于静止半径 8m
    feed(watcher, walkPts(mps, 600, 3));
    assert.equal(
      events.autoPause, 0,
      `${mps} m/s 连续 10 分钟被误判为静止（每步 ${(mps * 3).toFixed(1)}m < 8m）`,
    );
  }
});

test('只看静止时长：先跑 30 分钟，再原地静止满 5 分钟照样触发', () => {
  const { watcher, events } = make();
  const endM = 2.4 * 1800;
  // 跑 30 分钟后跳 100m 外停下（首个静止点越出锚点圈 → 重锚，再静止 330s）
  feed(watcher, [...walkPts(2.4, 1800, 3), ...stillFrom(1830, 11, { baseM: endM + 100 })]);
  assert.equal(events.autoPause, 1, '静止窗口只看自身时长，与前面运动了多久无关');
});

test('一段静止只触发一次', () => {
  const { watcher, events } = make();
  feed(watcher, stillFrom(0, 42)); // 静止 1260s
  assert.equal(events.autoPause, 1, '静止越线后只自动暂停一次');
  assert.equal(events.pauseStillSec, 330, '触发时上报的静止时长应是越线那一刻的 330s');
});

test('走动即重置：走出锚点圈后重新静止会再次触发', () => {
  const { watcher, events } = make();
  feed(watcher, stillFrom(0, 45)); // 1350s → 触发
  assert.equal(events.autoPause, 1);

  // 走一步跨出锚点圈（55m > 8m）→ 重锚、重新武装
  feed(watcher, [P(5, 1350), P(60, 1380)]);
  feed(watcher, stillFrom(1380, 11, { baseM: 60 }));
  assert.equal(events.autoPause, 2, '走出圈后重新静止满 5 分钟，应再次触发（计数已重置）');
});

test('断档（dt > MAX_STEP_SEC）重置计数', () => {
  const { watcher, events } = make();
  feed(watcher, stillFrom(0, 15)); // 450s → 触发一次
  assert.equal(events.autoPause, 1);

  // 断档 10 分钟（定位丢失）：中间可能走动过，不能接着算
  feed(watcher, [P(5, 450), P(5, 1050)]);
  feed(watcher, stillFrom(1050, 11, { baseM: 5 }));
  assert.equal(events.autoPause, 2, '断档重置后重新静止满 5 分钟，应再次触发——证明计数确实被清零');
});

test('跨暂停不累计（pauseGap 断档）：暂停前的静止不跨过暂停继续算', () => {
  const { watcher, events } = make();
  const pts = [
    ...stillFrom(0, 4), // 暂停前静止 120s（t=0..120）
    // 暂停 100s 后恢复：恢复后首个点带 pauseGap（tracker.resume 打的那个标）；这一步的 dt 就含着暂停那 100s
    { ...P(0, 220), pauseGap: true },
    ...stillFrom(250, 6, { baseM: 0 }).slice(1), // 恢复后再静止 180s
  ];
  feed(watcher, pts);
  assert.equal(events.autoPause, 0, '120s(暂停前) + 100s(暂停) + 180s 不该凑成一段静止');
});

test('阈值钉住：自动暂停 5 分钟、断档 180s、静止半径 8m', () => {
  assert.equal(STANDSTILL_LIVE_THRESHOLDS.AUTO_PAUSE_MIN_SEC, 300);
  assert.equal(STANDSTILL_LIVE_THRESHOLDS.MAX_STEP_SEC, 180);
  assert.equal(STANDSTILL_LIVE_THRESHOLDS.STILL_RADIUS_M, 8);
});

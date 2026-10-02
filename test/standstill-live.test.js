const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStandstillWatcher, STANDSTILL_LIVE_THRESHOLDS } = require('../miniprogram/utils/standstill-live.js');

/** 造相邻两点：位移 movedM 米、间隔 dt 秒 */
function twoPoints(movedM, dt) {
  const latDelta = movedM / 111320;
  return [
    { lat: 31.23, lng: 121.47, timestamp: 1790832000000 },
    { lat: 31.23 + latDelta, lng: 121.47, timestamp: 1790832000000 + dt * 1000 },
  ];
}

function make() {
  const events = { autoPause: 0, pauseStillSec: 0 };
  const watcher = createStandstillWatcher({
    onAutoPause: (info) => { events.autoPause++; events.pauseStillSec = info.stillSec; },
  });
  return { watcher, events };
}

/** 静止 n 步（每步 30s、位移 5m），返回结束时刻 */
function stillSteps(watcher, n, startT) {
  let t = startT;
  for (let i = 0; i < n; i++) {
    const [p, c] = twoPoints(5, 30);
    watcher.step(
      { ...p, timestamp: 1790832000000 + t * 1000 },
      { ...c, timestamp: 1790832000000 + (t + 30) * 1000 },
    );
    t += 30;
  }
  return t;
}

test('自动暂停线＝静止 5 分钟：整 5 分钟不触发，再多一步才触发', () => {
  const { watcher, events } = make();
  watcher.step(null, { lat: 31.23, lng: 121.47, timestamp: 1790832000000 });
  stillSteps(watcher, 10, 0);
  assert.equal(events.autoPause, 0, '静止整 300s 不算「超过 5 分钟」，不该触发');

  stillSteps(watcher, 1, 300);
  assert.equal(events.autoPause, 1, '静止 330s > 300s → 触发');
});

test('自动暂停只看静止时长：运动已很久时，静止 330s 照样触发（不要求 >1/3）', () => {
  const { watcher, events } = make();
  watcher.step(null, { lat: 31.23, lng: 121.47, timestamp: 1790832000000 });
  // 已运动很久（若还按 1/3 算，门槛会在 666s 量级），静止 330s 远达不到——但已 >5 分钟
  stillSteps(watcher, 11, 0);
  assert.equal(events.autoPause, 1, '静止 330s > 300s 即触发，与运动总时长无关');
  assert.equal(events.pauseStillSec, 330);
});

test('一段静止只触发一次', () => {
  const { watcher, events } = make();
  watcher.step(null, { lat: 31.23, lng: 121.47, timestamp: 1790832000000 });
  stillSteps(watcher, 42, 0);
  assert.equal(events.autoPause, 1, '静止 1260s 越线后只自动暂停一次');
  assert.equal(events.pauseStillSec, 330, '触发时上报的静止时长应是越线那一刻的 330s');
});

test('走动即重置：走动后重新静止会再次触发', () => {
  const { watcher, events } = make();
  watcher.step(null, { lat: 31.23, lng: 121.47, timestamp: 1790832000000 });
  let t = stillSteps(watcher, 45, 0);
  assert.equal(events.autoPause, 1, '第一次静止 1350s 已触发');

  // 走动一步（20m > 8m 阈值）→ 重新武装
  const [wp, wc] = twoPoints(20, 30);
  watcher.step(
    { ...wp, timestamp: 1790832000000 + t * 1000 },
    { ...wc, timestamp: 1790832000000 + (t + 30) * 1000 },
  );
  t += 30;

  stillSteps(watcher, 11, t);
  assert.equal(events.autoPause, 2, '走动后重新静止满 5 分钟，应再次触发（计数已重置）');
});

test('断档（dt > MAX_STEP_SEC）重置计数', () => {
  const { watcher, events } = make();
  watcher.step(null, { lat: 31.23, lng: 121.47, timestamp: 1790832000000 });
  let t = stillSteps(watcher, 15, 0);
  assert.equal(events.autoPause, 1, '断档前静止 450s 已触发一次');

  // 断档 10 分钟（定位丢失）：中间可能走动过，不能接着算
  const [gp, gc] = twoPoints(5, 600);
  watcher.step(
    { ...gp, timestamp: 1790832000000 + t * 1000 },
    { ...gc, timestamp: 1790832000000 + (t + 600) * 1000 },
  );
  t += 600;

  stillSteps(watcher, 11, t);
  assert.equal(events.autoPause, 2, '断档重置后重新静止满 5 分钟，应再次触发——证明计数确实被清零');
});

test('阈值钉住：自动暂停 5 分钟、断档 180s', () => {
  assert.equal(STANDSTILL_LIVE_THRESHOLDS.AUTO_PAUSE_MIN_SEC, 300);
  assert.equal(STANDSTILL_LIVE_THRESHOLDS.MAX_STEP_SEC, 180);
});

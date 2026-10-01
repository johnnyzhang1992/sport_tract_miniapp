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

function make(elapsedSec) {
  const events = { notify: 0, autoPause: 0, pauseStillSec: 0 };
  const watcher = createStandstillWatcher({
    onNotify: () => events.notify++,
    onAutoPause: (info) => { events.autoPause++; events.pauseStillSec = info.stillSec; },
  });
  return { watcher, events };
}

test('提醒级：连续静止 ≥10 分钟触发一次震动+toast 回调', () => {
  const { watcher, events } = make();
  let t = 0;
  let prev = null;
  let cur = { lat: 31.23, lng: 121.47, timestamp: 1790832000000 };
  for (let i = 0; i < 25; i++) {
    const [p, c] = twoPoints(5, 30);
    const pAbs = { ...p, timestamp: 1790832000000 + t * 1000 };
    const cAbs = { ...c, timestamp: 1790832000000 + (t + 30) * 1000 };
    watcher.step(prev || cur, pAbs, t);
    watcher.step(pAbs, cAbs, t + 30);
    prev = cAbs;
    cur = cAbs;
    t += 60;
  }
  assert.equal(events.notify, 1, '累计 750s ≥ 600s 触发一次提醒');
  assert.ok(events.autoPause === 0 || events.pauseStillSec > STANDSTILL_LIVE_THRESHOLDS.AUTO_PAUSE_MIN_SEC,
    '自动暂停只在静止超过 15 分钟后触发');
});

test('未达提醒阈值不触发', () => {
  const { watcher, events } = make();
  let t = 0;
  watcher.step(null, { lat: 31.23, lng: 121.47, timestamp: 1790832000000 }, 0);
  for (let i = 0; i < 10; i++) {
    const [p, c] = twoPoints(5, 30);
    const pAbs = { ...p, timestamp: 1790832000000 + t * 1000 };
    const cAbs = { ...c, timestamp: 1790832000000 + (t + 30) * 1000 };
    watcher.step(pAbs, cAbs, t + 30);
    t += 60;
  }
  assert.equal(events.notify, 0, '300s < 600s 不提醒');
});

test('自动暂停级：静止 >1/3 且 >15 分钟触发，且只触发一次', () => {
  const { watcher, events } = make();
  let t = 0;
  watcher.step(null, { lat: 31.23, lng: 121.47, timestamp: 1790832000000 }, 0);
  // 挂机场景：elapsed 1500s，静止 1250s（>83%）→ >900s 且 >500s(1/3) → 触发
  for (let i = 0; i < 42; i++) {
    const [p, c] = twoPoints(5, 30);
    const pAbs = { ...p, timestamp: 1790832000000 + t * 1000 };
    const cAbs = { ...c, timestamp: 1790832000000 + (t + 30) * 1000 };
    watcher.step(pAbs, cAbs, t + 30);
    t += 30;
  }
  assert.equal(events.autoPause, 1, '静止 1260s > 900s 且 > 1500s×1/3 → 自动暂停一次');
  assert.equal(events.notify, 1, '提醒级也应已触发（每级各一次）');
});

test('走动即重置：静止计数清零，两级观察器重新武装', () => {
  const { watcher, events } = make();
  let t = 0;
  watcher.step(null, { lat: 31.23, lng: 121.47, timestamp: 1790832000000 }, 0);
  // 静止 20 分钟（触发提醒）
  for (let i = 0; i < 45; i++) {
    const [p, c] = twoPoints(5, 30);
    const pAbs = { ...p, timestamp: 1790832000000 + t * 1000 };
    const cAbs = { ...c, timestamp: 1790832000000 + (t + 30) * 1000 };
    watcher.step(pAbs, cAbs, t + 30);
    t += 30;
  }
  assert.ok(events.notify >= 1, '应已提醒');
  // 走动一步（20m > 8m 阈值）
  const [wp, wc] = twoPoints(20, 30);
  const wpAbs = { ...wp, timestamp: 1790832000000 + t * 1000 };
  const wcAbs = { ...wc, timestamp: 1790832000000 + (t + 30) * 1000 };
  watcher.step(wpAbs, wcAbs, t + 30);
  t += 30;
  const notifyAfterMove = events.notify;
  // 再静止 11 分钟 → 重新提醒（计数已重置）
  for (let i = 0; i < 22; i++) {
    const [p, c] = twoPoints(5, 30);
    const pAbs = { ...p, timestamp: 1790832000000 + t * 1000 };
    const cAbs = { ...c, timestamp: 1790832000000 + (t + 30) * 1000 };
    watcher.step(pAbs, cAbs, t + 30);
    t += 30;
  }
  assert.ok(events.notify > notifyAfterMove, '走动后重新静止应再次提醒（计数已重置）');
});

test('断档（dt > MAX_STEP_SEC）重置计数', () => {
  const { watcher, events } = make();
  let t = 0;
  watcher.step(null, { lat: 31.23, lng: 121.47, timestamp: 1790832000000 }, 0);
  for (let i = 0; i < 15; i++) {
    const [p, c] = twoPoints(5, 30);
    const pAbs = { ...p, timestamp: 1790832000000 + t * 1000 };
    const cAbs = { ...c, timestamp: 1790832000000 + (t + 30) * 1000 };
    watcher.step(pAbs, cAbs, t + 30);
    t += 30;
  }
  // 断档 10 分钟（定位丢失）后静止 9 分钟 → 不应触发
  const [gp, gc] = twoPoints(5, 600);
  const gpAbs = { ...gp, timestamp: 1790832000000 + t * 1000 };
  const gcAbs = { ...gc, timestamp: 1790832000000 + (t + 600) * 1000 };
  watcher.step(gpAbs, gcAbs, t + 600);
  t += 600;
  for (let i = 0; i < 18; i++) {
    const [p, c] = twoPoints(5, 30);
    const pAbs = { ...p, timestamp: 1790832000000 + t * 1000 };
    const cAbs = { ...c, timestamp: 1790832000000 + (t + 30) * 1000 };
    watcher.step(pAbs, cAbs, t + 30);
    t += 30;
  }
  assert.equal(events.notify, 0, '断档重置后不足 10 分钟不应触发');
});

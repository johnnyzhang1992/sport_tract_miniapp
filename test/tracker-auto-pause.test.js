/**
 * 两个暂停量的口径（2026-10-02 定）：
 * - `pausedMs`：整场累计暂停，**含正在进行的这一段**；每次继续运动只往这里加，永不清零
 * - `autoPausedMs`：判"要不要自动暂停"的那个静止累计（`utils/standstill-live.js` 的 stillSec），
 *   走动归零、触发自动暂停后也归零
 * - 触发自动暂停时把**触发前那段静止回拨进暂停**（暂停起点回拨到静止开始），屏幕上的时长当场不再涨；
 *   但上传给服务端的 pausedMs 要减掉这段——那段有轨迹点可考，服务端纠偏按 still 段扣，两头都扣就是双扣
 * 跑法：node --test test/tracker-auto-pause.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

global.wx = {
  getStorageSync: () => '',
  setStorageSync: () => {},
  removeStorageSync: () => {},
  vibrateShort: () => {},
};
global.getApp = () => ({ globalData: {} });

const { Tracker } = require('../miniprogram/services/tracker');

const MIN = 60 * 1000;
const SEC = 1000;
const T0 = 1_700_000_000_000;

/** 可控时钟的 tracker：advance 推进"现在" */
const make = () => {
  let clock = T0;
  const t = new Tracker('running', 60, () => clock);
  return { t, advance: (ms) => { clock += ms; }, now: () => clock };
};

test('AP1 自动暂停触发：静止段回拨进暂停，屏幕时长当场不再涨，静止累计归零', () => {
  const { t, advance } = make();
  advance(25 * MIN); // 走 5 分钟 + 原地停 20 分钟，累计才够 20 分钟
  t.autoPausedMs = 20 * MIN; // 静止累计（判据用量）

  t.autoPause(20 * MIN);

  assert.equal(t.paused, true, '触发后是暂停态');
  assert.equal(t.autoPausedMs, 0, `触发即归零，实际 ${t.autoPausedMs}ms`);
  // 墙钟 25min，暂停起点回拨到"静止开始"那一刻（= 第 5 分钟）→ 时长冻在 5 分钟
  assert.equal(Math.round(t.getDurationSec()), Math.round((5 * MIN) / SEC), '静止段不该继续算进时长');
  assert.equal(t.snapshot().pausedMs, 20 * MIN, `回拨的静止段要立刻体现在合计里，实际 ${t.snapshot().pausedMs}ms`);
});

test('AP2 触发后继续运动：合计接着累加，上传值只算真暂停（不含回拨段）', () => {
  const { t, advance } = make();
  advance(25 * MIN);
  t.autoPause(20 * MIN); // 回拨 20 分钟
  advance(10 * MIN); // 真暂停 10 分钟（起点已被回拨）
  t.resume();

  // 合计 = 回拨 20 + 真暂停 10 = 30 分钟
  assert.equal(t.pausedMs, 30 * MIN, `合计要继续累加，实际 ${t.pausedMs}ms`);
  assert.equal(t.snapshot().autoPausedMs, 0, '继续运动后静止累计仍是 0');
  assert.equal(t.buildFinalPack().pausedMs, 10 * MIN, '交给服务端的只算真暂停，静止段由 still 规则扣');
});

test('AP3 手动暂停：不回拨、不动静止累计', () => {
  const { t, advance } = make();
  advance(5 * MIN);
  t.pause();
  advance(10 * MIN);

  assert.equal(Math.round(t.getDurationSec()), Math.round((5 * MIN) / SEC), '暂停期间不计时');
  assert.equal(t.snapshot().pausedMs, 10 * MIN, '合计含在途这段');
  t.resume();
  assert.equal(t.buildFinalPack().pausedMs, 10 * MIN, '手动暂停全额上传（没有回拨段可减）');
});

test('AP4 回拨不得早于开始时间（静止累计大于墙钟时）', () => {
  const { t, advance } = make();
  advance(2 * MIN);
  t.autoPause(90 * MIN); // 伪造一个超大的静止累计

  assert.ok(t.pausedAt >= t.startTime, `暂停起点不该跑到开始之前：pausedAt=${t.pausedAt} startTime=${t.startTime}`);
  assert.equal(t.snapshot().pausedMs, 2 * MIN, '最多回拨到起点，即整场都算暂停');
});

test('AP5 自动暂停后不继续、直接结束：上传值不得为负', () => {
  const { t, advance } = make();
  advance(5 * MIN);
  t.autoPause(20 * MIN); // 触发后没 resume 就结束：合计还没落账

  assert.equal(t.pausedMs, 0, '未继续运动时段未落账，合计仍是 0');
  assert.equal(t.buildFinalPack().pausedMs, 0, `减掉回拨段不能出现负数，实际 ${t.buildFinalPack().pausedMs}`);
});

/**
 * 端到端：真观察器 + 真节流判据，走 20 分钟（每分钟一点、每点 22m）后原地停
 * → 第 5 分钟：静止整 300s，不算"超过 5 分钟" → 不触发
 * → 第 6 分钟：静止 360s > 300s → 触发（与墙钟 1560s 无关）
 */
/**
 * 真实步速不误判：端上 3m/3s 节流后，走路每步 3.6~7.2m——都小于静止半径 8m。
 * 若静止判据拿「相邻点位移」比 8m，匀速走就会被当静止，5 分钟后误触发自动暂停。
 */
test('AP7 匀速慢走 10 分钟不自动暂停（静止判据要按锚点半径算，不是相邻点位移）', () => {
  let clock = T0;
  const t = new Tracker('running', 60, () => clock);
  t.onStandstillAutoPause = (info) => t.autoPause(info.stillSec * 1000);
  const LAT0 = 31.23;

  for (let k = 1; k <= 200; k++) {
    clock = T0 + k * 3 * 1000;
    // 1.2 m/s × 3s = 3.6m/步
    t.addPoint({ latitude: LAT0 + (1.2 * k * 3) / 111320, longitude: 121.47, accuracy: 10, timestamp: clock });
  }

  assert.equal(t.paused, false, '匀速慢走不该被自动暂停');
  // 走路时「当前静止窗口」最多攒到「离新锚点两小步」= 6s，远达不到 300s 的线
  assert.ok(t.autoPausedMs < 30 * 1000, `静止累计该远低于自动暂停线，实际 ${t.autoPausedMs}ms`);
});

/** 用户报的场景：暂停（<5 分钟）→ 继续行走 → 又被自动暂停；且总时长被这段误判吃掉 */
test('AP8 暂停后继续行走：暂停处断档，走动不再被误判为静止', () => {
  let clock = T0;
  const t = new Tracker('running', 60, () => clock);
  t.onStandstillAutoPause = (info) => t.autoPause(info.stillSec * 1000);
  const LAT0 = 31.23;
  let tSec = 0;
  let distM = 0;
  const walk = (sec) => {
    for (let i = 0; i < sec / 3; i++) {
      tSec += 3;
      distM += 1.2 * 3;
      clock = T0 + tSec * 1000;
      t.addPoint({ latitude: LAT0 + distM / 111320, longitude: 121.47, accuracy: 10, timestamp: clock });
    }
  };

  walk(120);      // 先正常走 2 分钟
  t.pause();
  tSec += 120;    // 暂停 2 分钟（不采点，墙钟照走）
  clock = T0 + tSec * 1000;
  t.resume();
  walk(300);      // 继续走 5 分钟

  assert.equal(t.paused, false, '暂停后继续行走 5 分钟不该被自动暂停');
  assert.ok(t.autoPausedMs < 30 * 1000, `静止累计该远低于自动暂停线，实际 ${t.autoPausedMs}ms`);
});

/** 暂停那段墙钟不能算进静止：不采点，但恢复后首个点的 dt 跨着整段暂停 */
test('AP9 暂停后原地不动：静止累计只算恢复之后那段，不把暂停时长算进来', () => {
  let clock = T0;
  const t = new Tracker('running', 60, () => clock);
  t.onStandstillAutoPause = (info) => t.autoPause(info.stillSec * 1000);
  const stillStanding = (sec) => {
    for (let i = 0; i < sec / 30; i++) {
      clock += 30 * 1000;
      t.addPoint({ latitude: 31.23, longitude: 121.47, accuracy: 10, timestamp: clock });
    }
  };

  stillStanding(120); // 暂停前已静止 2 分钟
  t.pause();
  clock += 120 * 1000; // 暂停 2 分钟（墙钟照走）
  t.resume();
  stillStanding(120); // 恢复后再静止 2 分钟

  assert.equal(t.paused, false, '恢复后静止 2 分钟（含暂停那段共 4 分钟）不该越过 5 分钟的线');
  assert.ok(t.autoPausedMs <= 120 * 1000, `只该算恢复之后那 120s，实际 ${t.autoPausedMs}ms`);
});

test('AP6 走点喂进 tracker：静止累计随点增长，触发那一步不把它写回去', () => {
  let clock = T0;
  const t = new Tracker('running', 60, () => clock);
  t.onStandstillAutoPause = (info) => t.autoPause(info.stillSec * 1000);

  const step = (lat, lng, offsetSec) => {
    clock = T0 + offsetSec * 1000;
    return t.addPoint({ latitude: lat, longitude: lng, accuracy: 10, timestamp: clock });
  };

  for (let k = 1; k <= 20; k++) step(31.23 + k * 0.0002, 121.47, k * 60);
  assert.equal(t.autoPausedMs, 0, '走动时静止累计应为 0');

  for (let j = 1; j <= 5; j++) step(31.23 + 20 * 0.0002, 121.47, (20 + j) * 60);
  assert.equal(t.paused, false, '静止整 300s 不算「超过 5 分钟」，不该触发');
  assert.equal(t.autoPausedMs, 5 * MIN, `静止累计要能报出来，实际 ${t.autoPausedMs}ms`);

  step(31.23 + 20 * 0.0002, 121.47, 26 * 60);
  assert.equal(t.paused, true, '静止 360s > 5min → 自动暂停');
  assert.equal(t.autoPausedMs, 0, `触发那一步不能把静止累计又写回去（已被 autoPause 归零），实际 ${t.autoPausedMs}ms`);
  assert.equal(t.snapshot().pausedMs, 6 * MIN, '触发前那 6 分钟静止当场并进暂停');
});

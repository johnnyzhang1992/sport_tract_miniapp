/**
 * 暂停边界的端上状态机（2026-10-04 复查补丁）
 *
 * - A1 静止/乘车观察器不跨暂停：暂停是硬边界，就地清空；恢复后首个被接受的点重新立锚。
 *   正确性**不与「恢复首点带没带上 pauseGap 标记」耦合**——真机库里 pauseGap 整体缺失
 *   （0/4186 条带该标记，原因未定位，见 docs 复查记录）。此前两个观察器唯一的复位路径就是
 *   喂到带标记的那个点（standstill-live.js 的 reanchor / vehicle-live.js 的 reset），
 *   标记一丢，暂停那段墙钟就会被当成静止继续累计 → 恢复后原地不动会当场二次自动暂停。
 * - B1 自动暂停回拨的那段静止要进「当前公里窗口的暂停时长」：否则实时整公里分段用时
 *   把回拨的静止算成运动（详情页分段来自服务端，不受影响）。
 * - B2 onUnload 摘掉全部页面回调（此前只摘了 onKilometer/onVehicle）。
 *
 * 跑法：node --test test/tracker-pause-boundary.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

global.wx = {
  getStorageSync: () => '',
  setStorageSync: () => {},
  removeStorageSync: () => {},
  showToast() {},
  showLoading() {},
  hideLoading() {},
  vibrateShort() {},
  vibrateLong() {},
  setKeepScreenOn() {},
  stopLocationUpdate() {},
  startLocationUpdate() {},
  startLocationUpdateBackground() {},
  onLocationChange() {},
  getSetting({ success }) { success({ authSetting: {} }); },
  getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667 }),
  createMapContext: () => ({}),
};
global.getApp = () => ({ globalData: {} });
let page = null;
global.Page = (o) => {
  page = o;
};

require.cache[require.resolve('../miniprogram/services/api.js')] = {
  id: require.resolve('../miniprogram/services/api.js'),
  filename: require.resolve('../miniprogram/services/api.js'),
  loaded: true,
  exports: { get: async () => ({}), post: async () => ({}), put: async () => ({}) },
  children: [],
  paths: [],
};

const { Tracker } = require('../miniprogram/services/tracker');
require('../miniprogram/pages/record/record.js');

const T0 = 1_700_000_000_000;
const LAT0 = 31.23;
const LNG0 = 121.47;
const latAt = (meters) => LAT0 + meters / 111320;

/**
 * 真机观测情形：恢复后首个点没带 pauseGap 标记。
 * 注入方式 = 直接把 tracker 的待打标位清掉，等价于「标记在链路上丢了」。
 * 真机库 0/4186 条带该标记，故端上不能把复位正确性押在它身上。
 */
test('PB1 恢复首点没带标记时，静止观察器不得跨暂停继续累计（不二次自动暂停）', () => {
  let clock = T0;
  const t = new Tracker('running', 60, () => clock);
  t.onStandstillAutoPause = (info) => t.autoPause(info.stillSec * 1000);
  const stand = (sec) => {
    for (let i = 0; i < sec / 30; i++) {
      clock += 30 * 1000;
      t.addPoint({ latitude: LAT0, longitude: LNG0, accuracy: 10, timestamp: clock });
    }
  };

  stand(120); // 原地静止 2 分钟（锚点落在第 1 步，stillSec≈90s，未越线）
  assert.equal(t.paused, false, '前置：只静止 2 分钟不该自动暂停');
  t.pause(); // 走一次真实的暂停边界（暂停前锚点仍记着）
  clock += 60 * 1000; // 暂停 1 分钟（暂停期间不采点，墙钟照走）
  t.resume();
  t._pendingGap = false; // ← 注入：恢复首点没带上标记
  stand(240); // 恢复后再原地静止 4 分钟

  assert.equal(t.paused, false, '标记缺失时，暂停那 1 分钟被算进静止 → 会当场二次自动暂停');
  assert.ok(t.autoPausedMs <= 240 * 1000, `静止累计只该算恢复之后那段，实际 ${t.autoPausedMs}ms`);
});

/**
 * 数字算例：1 点/30s、每点 24m（首点不累加距离，故 43 点 = 42×24 = 1008m 才跨过 1km）。
 * 走到 480m 时自动暂停回拨 300s 静止，再继续走到 1008m（t=1290s）跨过第 1 公里。
 * 分段用时 = 墙钟(1290s) − 本窗口暂停时长。回拨的 300s 必须算进暂停 → 990s；
 * 不算进 → 1290s（把 5 分钟静止当成运动时间报给用户）。
 */
test('PB2 自动暂停回拨的那段静止要进当前公里窗口的暂停时长（实时分段用时不算成运动）', () => {
  let clock = T0;
  let distM = 0;
  const t = new Tracker('running', 60, () => clock);
  let kmInfo = null;
  t.onKilometer = (info) => {
    kmInfo = info;
  };
  const walk = (n) => {
    for (let i = 0; i < n; i++) {
      clock += 30 * 1000;
      distM += 24;
      t.addPoint({ latitude: latAt(distM), longitude: LNG0, accuracy: 10, timestamp: clock });
    }
  };

  walk(20); // t=600s，480m
  t.autoPause(300 * 1000); // 自动暂停：把触发前 5 分钟静止回拨进暂停
  t.resume(); // 用户点「继续」（t 仍是 600s）
  walk(23); // t=1290s，1008m → 跨过第 1 公里

  assert.ok(kmInfo, '应跨过第 1 公里并回调');
  assert.equal(kmInfo.km, 1);
  assert.ok(
    kmInfo.splitSec >= 900 && kmInfo.splitSec <= 1000,
    `分段用时该扣掉回拨的 300s（≈990s），实际 ${kmInfo.splitSec}s——偏大即把静止算成了运动`,
  );
});

test('PB3 onUnload 摘掉全部页面回调（含静止自动暂停与点数封顶）', () => {
  const t = new Tracker('running', 60, () => T0);
  const ctx = Object.assign(Object.create(page), {
    data: { type: 'running' },
    tracker: t,
    sync: { stop() {} },
    statsTimer: null,
    _ending: true, // 正常结束路径：不进「存 ongoingActivity」分支
    setData() {},
  });
  t.onKilometer = () => {};
  t.onVehicle = () => {};
  t.onStandstillAutoPause = () => {};
  t.onPointsCap = () => {};

  page.onUnload.call(ctx);

  assert.equal(t.onKilometer, null);
  assert.equal(t.onVehicle, null);
  assert.equal(t.onStandstillAutoPause, null, '页面卸载后静止自动暂停不许再回调到已销毁的实例上');
  assert.equal(t.onPointsCap, null, '页面卸载后点数封顶提示不许再回调到已销毁的实例上');
});

/**
 * 自动暂停后「检测到走动就自动继续」的判据与接线。
 *
 * 只接系统按的暂停（静止挂机、无后台定位授权时切后台）；用户自己点「暂停」的永不自动接回。
 * 走动判据：连续 3 步、每步 ≥8m（与静止判据同口径）、每步间隔 ≤180s、合位移 ≥30m。
 * 跑法：node --test test/tracker-auto-resume.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

global.wx = {
  getStorageSync: () => '',
  setStorageSync: () => {},
  removeStorageSync: () => {},
  showToast(o) {
    toasts.push(o && o.title);
  },
  showLoading() {},
  hideLoading() {},
  vibrateShort() {},
  getSetting({ success }) { success({ authSetting: {} }); },
  createMapContext: () => ({}),
  getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667 }),
};
const toasts = [];
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

const MIN = 60 * 1000;
const T0 = 1_700_000_000_000;
const LAT0 = 31.23;
const LNG0 = 121.47;
/** 纬度 1 米 ≈ 1/111320 度 */
const latAt = (meters) => LAT0 + meters / 111320;

/** 自动暂停态的 tracker：走 10 分钟后原地静止 6 分钟触发 */
const autoPausedTracker = () => {
  let clock = T0;
  const t = new Tracker('running', 60, () => clock);
  t.onStandstillAutoPause = (info) => t.autoPause(info.stillSec * 1000);
  // 走 10 个点（每个 22m、间隔 60s）→ 再原地停 6 个点 → 静止 360s > 300s
  for (let k = 1; k <= 10; k++) {
    clock = T0 + k * 60 * 1000;
    t.addPoint({ latitude: latAt(k * 22), longitude: LNG0, accuracy: 10, timestamp: clock });
  }
  for (let j = 1; j <= 6; j++) {
    clock = T0 + (10 + j) * 60 * 1000;
    t.addPoint({ latitude: latAt(10 * 22), longitude: LNG0, accuracy: 10, timestamp: clock });
  }
  if (!t.paused) throw new Error('前置失败：应已进入自动暂停');
  return { t, clockAt: (sec) => { clock = T0 + sec * 1000; }, at: (sec) => T0 + sec * 1000 };
};

/** 喂一个"暂停期间"的定位（不入库，只参与走动判断） */
const feed = (t, meters, sec) => t.onLocationWhilePaused({ latitude: latAt(meters), longitude: LNG0, accuracy: 10, timestamp: T0 + sec * 1000 });

/** 暂停前最后一点在 220m 处；走动一律从那里往前推 */
const AT_REST_M = 220;

test('AR1 自动暂停后连走 3 步：自动恢复，恢复首点打 pauseGap，暂停合计含回拨的静止段', () => {
  const { t } = autoPausedTracker();

  assert.equal(feed(t, AT_REST_M + 22, 16 * 60 + 30), false, '第 1 步不该就恢复');
  assert.equal(feed(t, AT_REST_M + 44, 16 * 60 + 60), false, '第 2 步不该就恢复');
  assert.equal(feed(t, AT_REST_M + 66, 16 * 60 + 90), true, '第 3 步（连续 3 步各 22m、合计 66m）应恢复');
  assert.equal(t.paused, false);

  const point = t.addPoint({ latitude: latAt(AT_REST_M + 88), longitude: LNG0, accuracy: 10, timestamp: T0 + 17 * 60 * 1000 });
  assert.ok(point && point.pauseGap === true, '自动恢复也要打 pauseGap（与手动恢复同一条链，服务端靠它断线/反推空窗）');
  assert.ok(t.pausedMs >= 6 * MIN, `静止那 6 分钟要留在合计里，实际 ${(t.pausedMs / MIN).toFixed(2)} 分钟`);
});

test('AR2 只走 2 步就停下：不恢复', () => {
  const { t } = autoPausedTracker();
  feed(t, AT_REST_M + 22, 16 * 60 + 30);
  feed(t, AT_REST_M + 44, 16 * 60 + 60);
  const still = t.onLocationWhilePaused({ latitude: latAt(AT_REST_M + 44), longitude: LNG0, accuracy: 10, timestamp: T0 + 16 * 60 * 1000 + 90000 });

  assert.equal(still, false);
  assert.equal(t.paused, true, '仍应是暂停态');
});

test('AR3 用户手动暂停：走多少步都不自动恢复', () => {
  let clock = T0;
  const t = new Tracker('running', 60, () => clock);
  clock = T0 + 5 * MIN;
  t.pause();

  for (let k = 1; k <= 6; k++) {
    assert.equal(feed(t, k * 30, 5 * 60 + k * 30), false, `手动暂停第 ${k} 步不该恢复`);
  }
  assert.equal(t.paused, true);
});

test('AR4 每步刚过 8m 但合位移不足 30m：不恢复（合位移这条在生效）', () => {
  const { t } = autoPausedTracker();
  // 3 步各 9m = 27m < 30m：单步都够，合起来不够，不算走动
  feed(t, AT_REST_M + 9, 16 * 60 + 30);
  feed(t, AT_REST_M + 18, 16 * 60 + 60);
  assert.equal(feed(t, AT_REST_M + 27, 16 * 60 + 90), false, '连续 3 步但合位移 27m < 30m → 不算走动');
  assert.equal(t.paused, true);
});

test('AR5 中间有一步间隔超 180s：计数重来，不恢复', () => {
  const { t } = autoPausedTracker();
  feed(t, AT_REST_M + 22, 16 * 60 + 30);
  feed(t, AT_REST_M + 44, 16 * 60 + 60);
  feed(t, AT_REST_M + 66, 16 * 60 + 460); // 断档 400s 的一步：不可信，重新起算
  assert.equal(t.paused, true, '断档那步不该凑满 3 步');
  assert.equal(feed(t, AT_REST_M + 88, 16 * 60 + 490), false, '断档后只走了 1 步');
  assert.equal(feed(t, AT_REST_M + 110, 16 * 60 + 520), false, '断档后 2 步');
  assert.equal(feed(t, AT_REST_M + 132, 16 * 60 + 550), true, '断档后重新连满 3 步才恢复');
});

test('AR6 抖一步又原地不动：不恢复（"连续"这条在生效）', () => {
  const { t } = autoPausedTracker();
  feed(t, AT_REST_M + 12, 16 * 60 + 30); // 单步 12m 的 GPS 抖动
  feed(t, AT_REST_M + 12, 16 * 60 + 60); // 又回到原地
  feed(t, AT_REST_M + 13, 16 * 60 + 90);
  assert.equal(t.paused, true);
});

/** 暂停态的页面上下文（updateStats 里那些刷新与"接回"无关，桩掉） */
const pageCtx = (tracker) => Object.assign(Object.create(page), {
  data: { type: 'running', paused: true, stats: { altitude: 0 } },
  tracker,
  setData(patch) {
    Object.assign(this.data, patch);
  },
  updateStats() {},
});

const locAt = (meters, sec) => ({ latitude: latAt(meters), longitude: LNG0, accuracy: 10, timestamp: T0 + sec * 1000 });

test('W4 页面在自动暂停态收到走动定位：接回记录、状态翻页、给一次提示', () => {
  const { t } = autoPausedTracker();
  const ctx = pageCtx(t);
  toasts.length = 0;

  page.onLocation.call(ctx, locAt(AT_REST_M + 22, 16 * 60 + 30));
  page.onLocation.call(ctx, locAt(AT_REST_M + 44, 16 * 60 + 60));
  assert.equal(ctx.data.paused, true, '两步还不该恢复');
  page.onLocation.call(ctx, locAt(AT_REST_M + 66, 16 * 60 + 90));

  assert.equal(t.paused, false, '第三步应已接回记录');
  assert.equal(ctx.data.paused, false, '页面状态要跟着翻，否则按钮还停在「继续」');
  assert.deepEqual(toasts, ['检测到运动，已自动继续'], `要有一次提示且只一次，实际 ${JSON.stringify(toasts)}`);
});

test('W5 页面在手动暂停态收到走动定位：不接回、不提示', () => {
  let clock = T0;
  const t = new Tracker('running', 60, () => clock);
  clock = T0 + 5 * MIN;
  t.pause();
  const ctx = pageCtx(t);
  toasts.length = 0;

  for (let k = 1; k <= 5; k++) page.onLocation.call(ctx, locAt(k * 30, 5 * 60 + k * 30));

  assert.equal(t.paused, true, '用户自己按的暂停只能由用户接回');
  assert.deepEqual(toasts, [], '手动暂停不该冒「已自动继续」');
});

/**
 * 「继续上次运动」恢复现场时，暂停时长必须仍然算暂停，不能回流成运动时长。
 *
 * 关键事实：整场录制期间 sync 只上传轨迹点（sync.js upload 的 body 只有 fromSeq + points），
 * pausedMs 直到结束才随 final 包写入 —— 所以 in_progress 活动从 GET /activities/:id 拿到的
 * pausedMs 恒为 0（服务端 finish 是唯一写入者）。而本地现场 ongoingActivity 里是有 pausedMs 的
 * （record.js onUnload 存了），resume() 却只用了 pausedAt，等于把这一段暂停丢了。
 * 跑法：node --test test/record-resume-paused.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const storage = {};
global.wx = {
  getStorageSync: (k) => storage[k] ?? '',
  setStorageSync: (k, v) => {
    storage[k] = v;
  },
  removeStorageSync: (k) => {
    delete storage[k];
  },
  showToast() {},
  showLoading() {},
  hideLoading() {},
  setKeepScreenOn() {},
  stopLocationUpdate() {},
  getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667 }),
  getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667 }),
  createMapContext: () => ({}),
};
global.getApp = () => ({ globalData: {}, hasSession: () => false });
let page = null;
global.Page = (o) => {
  page = o;
};

const apiStub = { get: null };
require.cache[require.resolve('../miniprogram/services/api.js')] = {
  id: require.resolve('../miniprogram/services/api.js'),
  filename: require.resolve('../miniprogram/services/api.js'),
  loaded: true,
  exports: { get: (url) => apiStub.get(url), post: async () => ({}), put: async () => ({}) },
  children: [],
  paths: [],
};

require('../miniprogram/pages/record/record.js');

const MIN = 60 * 1000;

/** 录制 30 分钟 → 其中累计暂停 10 分钟 → 5 分钟前杀进程 */
const buildCtx = ({ now, serverPausedMs }) => {
  const startTime = now - 30 * MIN;
  storage.ongoingActivity = { activityId: 'aid', type: 'running', pausedAt: now - 5 * MIN, pausedMs: 10 * MIN };
  apiStub.get = () =>
    Promise.resolve({
      _id: 'aid',
      status: 'in_progress',
      startTime,
      pausedMs: serverPausedMs,
      trackPoints: [
        { seq: 1, lat: 31.23, lng: 121.47, timestamp: startTime },
        { seq: 2, lat: 31.235, lng: 121.475, timestamp: startTime + MIN },
      ],
      markers: [],
    });
  const ctx = Object.create(page);
  Object.assign(ctx, {
    data: { type: 'running', paused: false, starting: true, stats: { altitude: 0 } },
    statsTimer: null,
    setData(patch) {
      Object.assign(this.data, patch);
    },
    startLocation() {},
    maybeShowCapsuleGuide() {},
  });
  return ctx;
};

const cleanup = (ctx) => {
  if (ctx.statsTimer) clearInterval(ctx.statsTimer);
  if (ctx.sync) ctx.sync.stop();
};

test('R1 本地现场有 pausedMs：恢复后已暂停的 10 分钟不得算成运动时长', async () => {
  const ctx = buildCtx({ now: Date.now(), serverPausedMs: 0 });

  await page.resume.call(ctx, 'aid', 'running');
  const pausedMs = ctx.tracker.pausedMs;
  const durationSec = ctx.tracker.getDurationSec();
  cleanup(ctx);

  // 墙钟 30min − 暂停(10min 已累计 + 5min 关档窗口) = 运动 15min
  assert.ok(
    Math.abs(pausedMs - 15 * MIN) < 2000,
    `pausedMs 应为 15 分钟（10 累计 + 5 关闭窗口），实际 ${(pausedMs / MIN).toFixed(2)} 分钟`,
  );
  assert.ok(
    Math.abs(durationSec - 15 * 60) < 2,
    `时长应约 15 分钟，实际 ${(durationSec / 60).toFixed(2)} 分钟`,
  );
});

test('R2 没有本地现场（清缓存/换设备）：只能退回服务端值，此时暂停全算进时长', async () => {
  const ctx = buildCtx({ now: Date.now(), serverPausedMs: 0 });
  delete storage.ongoingActivity;

  await page.resume.call(ctx, 'aid', 'running');
  const durationSec = ctx.tracker.getDurationSec();
  cleanup(ctx);

  // 钉住「服务端 pausedMs 恒 0 时客户端无从修正」这一现状：这一档要变好，得让 pausedMs 进同步链路
  assert.ok(
    Math.abs(durationSec - 30 * 60) < 2,
    `无本地现场时把整段墙钟 30 分钟算成运动，实际 ${(durationSec / 60).toFixed(2)} 分钟`,
  );
});

test('R3 恢复现场：合计 pausedMs 与其中的回拨段都要接住，静止累计归零', async () => {
  const ctx = buildCtx({ now: Date.now(), serverPausedMs: 0 });
  storage.ongoingActivity.backdatedMs = 6 * MIN; // 那 10 分钟里有 6 分钟是自动暂停回拨进来的静止段

  await page.resume.call(ctx, 'aid', 'running');
  const snap = ctx.tracker.snapshot();
  const uploadMs = ctx.tracker.buildFinalPack().pausedMs;
  cleanup(ctx);

  assert.ok(Math.abs(snap.pausedMs - 15 * MIN) < 2000, `合计要接得上，实际 ${(snap.pausedMs / MIN).toFixed(2)} 分钟`);
  // 恢复后是暂停态，合计里还带着"暂停起点→现在"这几毫秒的在途段，所以留容差
  assert.ok(Math.abs(uploadMs - 9 * MIN) < 2000, `上传要减掉回拨的 6 分钟（服务端按 still 段扣），实际 ${(uploadMs / MIN).toFixed(4)} 分钟`);
  // 静止累计是当场判自动暂停用的量，跨恢复不延续
  assert.equal(snap.autoPausedMs, 0, `恢复后应归零，实际 ${snap.autoPausedMs}ms`);
});

/** 从恢复出来的最后一点往前走 meters 米、晚 sec 秒的一个定位（时间接在最后一点后面，才不被当断档） */
const moveLoc = (ctx, meters, sec) => {
  const last = ctx.tracker.lastPoint;
  return { latitude: last.lat + meters / 111320, longitude: last.lng, accuracy: 10, timestamp: last.timestamp + sec * 1000 };
};

test('R4 恢复现场：只有系统按过的暂停，走动才允许自动接回', async () => {
  const ctxAuto = buildCtx({ now: Date.now(), serverPausedMs: 0 });
  storage.ongoingActivity.pausedBy = 'auto'; // 退出前是静止挂机被系统按下的
  await page.resume.call(ctxAuto, 'aid', 'running');
  const resumed = [1, 2, 3].map((k) => ctxAuto.tracker.onLocationWhilePaused(moveLoc(ctxAuto, k * 22, k * 30)));
  const autoPausedAfter = ctxAuto.tracker.paused;
  cleanup(ctxAuto);

  assert.equal(resumed[2], true, `系统按过的暂停该在走动 3 步后接回，实际 ${JSON.stringify(resumed)}`);
  assert.equal(autoPausedAfter, false);

  const ctxManual = buildCtx({ now: Date.now(), serverPausedMs: 0 });
  await page.resume.call(ctxManual, 'aid', 'running'); // 现场没记 pausedBy（含"退出页面"那次程序替用户按的）
  const kept = [1, 2, 3, 4, 5].map((k) => ctxManual.tracker.onLocationWhilePaused(moveLoc(ctxManual, k * 22, k * 30)));
  const manualStillPaused = ctxManual.tracker.paused;
  cleanup(ctxManual);

  assert.ok(kept.every((r) => r === false), '用户自己按的暂停不能自己接回去');
  assert.equal(manualStillPaused, true);
});

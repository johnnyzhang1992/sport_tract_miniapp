/**
 * 运动页三条暂停入口的接线：只有「静止挂机」那条要把触发前的静止段回拨进暂停。
 *
 * 切后台（无后台定位授权）与用户点「暂停」都不回拨——它们前面没有"被误当运动的静止段"要救。
 * 跑法：node --test test/record-auto-pause-source.test.js
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
  getSetting({ success }) { success({ authSetting: {} }); },
  createMapContext: () => ({}),
};
global.getApp = () => ({ globalData: {}, hasSession: () => false });
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

require('../miniprogram/pages/record/record.js');
const { Tracker } = require('../miniprogram/services/tracker');

const MIN = 60 * 1000;

/** 可控时钟的真 tracker + 只接住 setData 的页面上下文（墙钟已走 25 分钟） */
const makeCtx = () => {
  let clock = 1_700_000_000_000;
  const tracker = new Tracker('running', 60, () => clock);
  const ctx = Object.assign(Object.create(page), {
    data: { type: 'running', paused: false, stats: { altitude: 0 } },
    tracker,
    _hasBackgroundAuth: false,
    setData(patch) {
      Object.assign(this.data, patch);
    },
    updateStats() {},
    advance: (ms) => {
      clock += ms;
    },
    now: () => clock,
  });
  ctx.advance(25 * MIN);
  return ctx;
};

test('W1 静止挂机自动暂停：页面把触发前那 20 分钟静止交给 tracker 回拨', () => {
  const ctx = makeCtx();

  page.onStandstillAutoPause.call(ctx, { stillSec: 20 * 60 });
  ctx.tracker.resume();

  assert.equal(ctx.tracker.pausedMs, 20 * MIN, `那 20 分钟要算进暂停，实际 ${(ctx.tracker.pausedMs / MIN).toFixed(2)} 分钟`);
  assert.equal(ctx.tracker.buildFinalPack().pausedMs, 0, '回拨段不能上传（服务端按 still 段扣，两头扣就是双扣）');
});

test('W2 无后台定位授权时切后台：普通暂停不回拨，但算系统暂停（走动可自动接回）', () => {
  const ctx = makeCtx();

  page.onHide.call(ctx);
  const pausedAt = ctx.tracker.pausedAt;
  ctx.advance(6 * MIN);
  ctx.tracker.resume();
  ctx.setData({ paused: false }); // 现实里这一步由 updateStats 顺带做掉

  assert.ok(Math.abs(pausedAt - (ctx.tracker.startTime + 25 * MIN)) < 1000, '暂停起点就是切后台那一刻');
  assert.equal(ctx.tracker.pausedMs, 6 * MIN, '只算真暂停那 6 分钟');
  assert.equal(ctx.tracker.buildFinalPack().pausedMs, 6 * MIN, '没有回拨段可减');

  // 系统按的这一次，走动够 3 步就该自己接回去（与静止挂机同一条路）
  ctx.tracker.addPoint({ latitude: 31.23, longitude: 121.47, accuracy: 10, timestamp: ctx.now() });
  page.onHide.call(ctx);
  const last = ctx.tracker.lastPoint;
  const feed = (meters, sec) => ctx.tracker.onLocationWhilePaused({
    latitude: last.lat + meters / 111320,
    longitude: last.lng,
    accuracy: 10,
    timestamp: ctx.now() + sec * 1000,
  });
  assert.equal(feed(22, 30), false, '第 1 步不该恢复');
  assert.equal(feed(44, 60), false, '第 2 步不该恢复');
  assert.equal(feed(66, 90), true, '切后台的暂停也该在走动 3 步后自动接回');
});

test('W4 静止满 5 分钟只弹一条 toast（提醒级与自动暂停合并成一个出口）', () => {
  const toasts = [];
  const realToast = global.wx.showToast;
  global.wx.showToast = (o) => toasts.push(o && o.title);

  const ctx = makeCtx();
  const t = page.newTracker.call(ctx, 'running'); // 与生产同一条接线
  ctx.tracker = t; // page.onStandstillAutoPause 里读的是 this.tracker

  const T0 = 1_790_832_000_000;
  for (let i = 1; i <= 12; i++) {
    t.addPoint({ latitude: 31.23, longitude: 121.47, accuracy: 10, timestamp: T0 + i * 30 * 1000 });
  }
  global.wx.showToast = realToast;

  assert.equal(t.paused, true, '这一刻应已自动暂停');
  const stillToasts = toasts.filter((s) => s && s.indexOf('静止') >= 0);
  assert.equal(stillToasts.length, 1, `5 分钟只该弹一条，实际 ${JSON.stringify(toasts)}`);
});

test('W3 用户点「暂停」按钮：普通暂停，不回拨', () => {
  const ctx = makeCtx();

  page.togglePause.call(ctx);
  ctx.advance(4 * MIN);
  ctx.tracker.resume();

  assert.equal(ctx.tracker.pausedMs, 4 * MIN);
  assert.equal(ctx.tracker.buildFinalPack().pausedMs, 4 * MIN);
});

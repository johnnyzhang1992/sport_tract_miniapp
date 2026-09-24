/**
 * 轨迹详情页「单段明细」口径回归（pages/track-detail/track-detail.js#computeKmSegments）
 *
 * 只 require 页面模块、直接调这一个方法：`Page()` 是全局注入的工厂，把 options 抓下来即可，
 * 不需要挂整页（地图/图表/接口都不参与这段纯计算）。
 *
 * 背景：运动时长在服务端 finish 时已扣掉「静止时段」（utils/standstill.ts 打的 still 标记），
 * 单段明细若仍把静止时间算进每公里用时，各段之和就会大于头部的运动时长——数字自相矛盾。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

let page = null;
global.wx = {
  getStorageSync: () => '',
  setStorageSync() {},
  removeStorageSync() {},
  getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667 }),
  getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667 }),
};
global.getApp = () => ({ globalData: {}, hasSession: () => false });
global.Page = (o) => {
  page = o;
};
require('../miniprogram/pages/track-detail/track-detail.js');

/** 纯纬度递增：lat = m * DEG_PER_M 时两点实测距离 = 传入米数 */
const DEG_PER_M = 180 / (Math.PI * 6371000);
const pt = (m, ts, extra = {}) => ({ lat: m * DEG_PER_M, lng: 0, timestamp: ts, ...extra });

/**
 * 1km 轨迹：0→500m 跑 150s、在 500m 处站 50s、再 500m→1002m 跑 150s。
 * 静止段两端各接一个 dt=0 的边界点，消除边界归属的歧义，好断言「只差静止段这 50s」。
 * 末点取 1002m（而不是 1000m）是为了避开浮点误差：凑不满 1000 会整段变成 partial。
 */
function buildTrack(markStill) {
  const pts = [];
  for (let m = 0; m <= 500; m += 100) pts.push(pt(m, m * 300)); // ts: 0..150000
  for (let k = 0; k <= 10; k++) pts.push(pt(500, 150000 + k * 5000, { still: markStill })); // 150000..200000
  const tail = [600, 700, 800, 900, 1002];
  tail.forEach((m, i) => pts.push(pt(m, 200000 + i * 30000))); // 200000..320000
  return pts;
}

test('单段明细：静止时段不计入该公里用时（对照可证）', () => {
  const withStill = page.computeKmSegments(buildTrack(true));
  const without = page.computeKmSegments(buildTrack(false));
  assert.equal(withStill.length, 1);
  assert.equal(without.length, 1);
  assert.equal(without[0].durationSec, 320, '不打标记时应含静止的 50s（前 150 + 静止 50 + 后 120）');
  assert.equal(withStill[0].durationSec, 270, '带 still 标记时应剔掉这 50s');
});

test('单段明细：pauseGap 与 >60s 断档仍不计时（既有口径不回归）', () => {
  const pts = [pt(0, 0), pt(100, 30000), pt(50000, 90000, { pauseGap: true }), pt(50100, 120000)];
  const segs = page.computeKmSegments(pts);
  assert.ok(segs.length >= 1);
  // pauseGap 那一步的 60s 不算：段时长只含 0→100m 的 30s 与恢复后的 30s
  assert.equal(segs[0].durationSec, 60);
  assert.equal(Math.round(segs[0].distKm * 1000), 200, '跨暂停的距离不计（100m + 100m）');
});

test('单段明细：正常轨迹每公里用时 = 各段之和，余段标 partial', () => {
  const pts = [];
  let ts = 0;
  for (let m = 0; m <= 1000; m += 100) {
    pts.push(pt(m, ts));
    ts += 30000; // 100m / 30s → 300 s/km
  }
  pts.push(pt(1400, ts)); // 尾段 400m / 30s（间隔 ≤60s，不算断档）
  const segs = page.computeKmSegments(pts);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].durationSec, 300);
  assert.equal(segs[0].partial, undefined);
  assert.equal(segs[1].partial, true, '不足 1km 的尾段标 partial');
  assert.equal(segs[1].durationSec, 30);
});

/**
 * 车速段（服务端 vehicle 标记）：明细外观不变，但数字必须与头部同源
 * 背景：服务端 finish 已把车速段的位移与时长一起剔出 distance/duration，
 * 单段明细若不剔同样的段，各段之和会比头部距离大出一截（4.67km 头上写着、明细加起来 5.9km）
 */
function mixedVehicleTrack(markVehicle) {
  const pts = [pt(0, 0)];
  // A：2.5 m/s 自己跑满 1km / 400s（每步 100m/40s，dt≤60s 才不被当成采样断档）
  for (let m = 100; m <= 1000; m += 100) pts.push(pt(m, (m / 100) * 40000));
  // B：搭车 1km / 100s（10 m/s），点上车速标记
  for (let k = 1; k <= 5; k++) {
    pts.push(pt(1000 + k * 200, 400000 + k * 20000, markVehicle ? { vehicle: true } : {}));
  }
  // C：再自己跑 500m / 200s（每步 dt ≤60s）
  for (const [m, ts] of [[2100, 540000], [2200, 580000], [2350, 640000], [2500, 700000]]) pts.push(pt(m, ts));
  return pts;
}

test('单段明细：车速段的位移与时长同样剔掉，各段之和与头部口径自洽', () => {
  const sum = (segs) => segs.reduce((s, x) => s + x.distKm, 0);
  const secs = (segs) => segs.reduce((s, x) => s + x.durationSec, 0);
  const marked = page.computeKmSegments(mixedVehicleTrack(true));
  assert.ok(Math.abs(sum(marked) - 1.5) < 0.01, `剔除后各段距离之和应 1.50km，实际 ${sum(marked)}`);
  assert.equal(secs(marked), 600, `剔除后各段用时之和应 600s，实际 ${secs(marked)}`);
  // 对照：不带标记时那 1km/100s 会整块落进明细
  const plain = page.computeKmSegments(mixedVehicleTrack(false));
  assert.ok(Math.abs(sum(plain) - 2.5) < 0.01, `对照组应 2.50km，实际 ${sum(plain)}`);
  assert.equal(secs(plain), 700, `对照组应 700s，实际 ${secs(plain)}`);
});

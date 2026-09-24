/**
 * track-map 组件「非运动段灰显」回归（components/track-map/track-map.js）
 *
 * 只把 Component() 工厂抓下来、拿这一个方法用假 this 调：地图与 setData 都不参与，
 * 但断的是真口径——vehicle 步必须染成 VEHICLE_COLOR，且配速模式与海拔模式两种着色都要盖到。
 * 跑法：node --test test/track-map-vehicle.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

let comp = null;
global.Component = (o) => {
  comp = o;
};
global.wx = {
  getStorageSync: () => '',
  setStorageSync() {},
  createMapContext: () => ({ includePoints() {}, moveToLocation() {} }),
};
require('../miniprogram/components/track-map/track-map.js');

const VEHICLE_COLOR = '#c9cdd4';
const M_PER_DEG = 180 / (Math.PI * 6371000);
const T0 = 1700000000000;

/** 每步 { sec, speed, vehicle?, altitude? }，沿经线推进；dt 都 ≤60s 以免被当断档 */
function track(steps) {
  let m = 0;
  let t = T0;
  const pts = [{ lat: 30, lng: 114.4, timestamp: t, altitude: 100 }];
  for (const s of steps) {
    m += s.speed * s.sec;
    t += s.sec * 1000;
    pts.push({
      lat: 30 + m * M_PER_DEG,
      lng: 114.4,
      timestamp: t,
      altitude: s.altitude != null ? s.altitude : 100 + Math.round(m / 10),
      ...(s.vehicle ? { vehicle: true } : {}),
    });
  }
  return pts;
}

/** 用假 this 调 buildPolyline，返回 setData 收到的 polyline */
function build(points, colorMode, activityType) {
  let out = null;
  const ctx = {
    data: { mode: 'single', points, markers: [], colorMode, activityType, overviewTracks: [] },
    setData(obj) {
      out = obj.polyline ?? out;
    },
    buildAltitudePolyline: comp.methods.buildAltitudePolyline,
    buildPacePolyline: comp.methods.buildPacePolyline,
    buildDefaultPolyline: comp.methods.buildDefaultPolyline,
  };
  comp.methods.buildPolyline.call(ctx);
  assert.ok(out, 'buildPolyline 应 setData 一份 polyline');
  return out;
}

const run200 = { sec: 20, speed: 2.5 }; // 2.5 m/s 自己跑 50m
const car50 = { sec: 7, speed: 50 / 7 }; // ≈7.1 m/s 搭车 50m（与服务端门槛同量级）

test('配速模式：vehicle 步单独成灰段，其余仍是配速档色', () => {
  const pts = track([run200, run200, car50, car50, run200]);
  pts[3].vehicle = true; // 进入第 3 点那一步是搭车
  pts[4].vehicle = true;
  const lines = build(pts, 'pace', 'running');
  const greys = lines.filter((l) => l.color === VEHICLE_COLOR);
  assert.equal(greys.length, 1, '连续两步搭车应合并成一条灰线');
  assert.equal(greys[0].points.length, 3, '灰线含起终点共 3 个点');
  const others = lines.filter((l) => l.color !== VEHICLE_COLOR);
  assert.ok(others.length >= 1, '其余步仍按配速档上色');
  assert.ok(others.every((l) => /^#[0-9a-f]{6}$/.test(l.color) && l.color !== VEHICLE_COLOR));
});

test('海拔模式（徒步）：vehicle 步照样灰，不被海拔档抢走', () => {
  const pts = track([run200, car50, car50, { sec: 20, speed: 2.5, altitude: 400 }]);
  pts[2].vehicle = true;
  pts[3].vehicle = true;
  const lines = build(pts, 'altitude', 'hiking');
  const greys = lines.filter((l) => l.color === VEHICLE_COLOR);
  assert.equal(greys.length, 1, '海拔模式下也要出灰段');
  assert.ok(lines.some((l) => l.color !== VEHICLE_COLOR && l.color !== '#c9cdd4'), '非车速段仍按海拔分色');
});

test('没有 vehicle 标记时一段灰都不出（不该把正常轨迹画灰）', () => {
  const lines = build(track([run200, run200, car50, car50]), 'pace', 'running');
  assert.equal(lines.filter((l) => l.color === VEHICLE_COLOR).length, 0);
});

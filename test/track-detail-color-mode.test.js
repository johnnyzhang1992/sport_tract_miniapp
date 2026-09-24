/**
 * 详情页 colorMode 的接线回归（pages/track-detail/track-detail.js#loadDetail）
 *
 * colorMode 一头决定图例文案（「海拔低 → 海拔高」），一头决定 track-map 走哪条画线分支，
 * 两边门槛曾不一致：海拔曲线只要有 1 个有效点就算非空 → 图例说「按海拔」，而
 * buildAltitudePolyline 要段内 ≥2 个有效海拔点才画得出线 —— 用户看到「有图例、没轨迹」。
 * 这里驱动真实 loadDetail（api.get 打桩喂一条轨迹，其余纯计算走页面自己的方法），
 * 只断言 setData 出来的 colorMode，别把结论建立在「util 对了页面自然也对了」上。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

let page = null;
global.wx = {
  getStorageSync: () => '',
  setStorageSync() {},
  removeStorageSync() {},
  showToast() {},
  getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667 }),
  getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667 }),
};
global.getApp = () => ({ globalData: {}, hasSession: () => false });
global.Page = (o) => {
  page = o;
};
require('../miniprogram/pages/track-detail/track-detail.js');
const api = require('../miniprogram/services/api.js');

/** 纯纬度递增的 n 个点（每点间隔 200m、每 60s 一点），其中前 k 个带海拔且海拔递增 */
function track(n, k) {
  const DEG_PER_M = 180 / (Math.PI * 6371000);
  return Array.from({ length: n }, (_, i) => ({
    seq: i + 1,
    lat: 30 + i * 200 * DEG_PER_M,
    lng: 120,
    timestamp: 1760000000000 + i * 60000,
    altitude: i < k ? 100 + i : null,
  }));
}

async function load(type, points) {
  api.get = async () => ({
    id: 'act_colormode',
    type,
    trackPoints: points,
    markers: [],
    startTime: points[0].timestamp,
    endTime: points[points.length - 1].timestamp,
    duration: 600,
    totalDuration: 600,
    distance: 200 * (points.length - 1),
    avgPace: 180,
    calories: 60,
    elevationGain: 5,
    status: 'finished',
  });
  const set = {};
  const self = {
    data: { id: 'act_colormode', mapType: 'standard', activity: null, markerList: [] },
    setData: (patch) => Object.assign(set, patch),
  };
  // 页面其余方法（computeKmSegments / computeKmMarkers / buildRunZones …）原样挂上并绑到这个假 this
  for (const [k, v] of Object.entries(page)) {
    if (typeof v === 'function') self[k] = v.bind(self);
  }
  await page.loadDetail.call(self);
  return { colorMode: set.colorMode, chartLen: (set.altitudeChart || []).length };
}

test('CM1 徒步且有 ≥2 个有效海拔点：按海拔着色（对照，防退回逻辑把正常样本也改掉）', async () => {
  const out = await load('hiking', track(8, 8));
  assert.equal(out.colorMode, 'altitude');
  assert.equal(out.chartLen, 8, '海拔曲线照旧出');
});

test('CM2 徒步只有 1 个有效海拔点：退回配速档（图例不能写海拔而线画不出）', async () => {
  const out = await load('hiking', track(8, 1));
  assert.equal(out.chartLen, 1, '曲线仍返回 1 个点（wxml 的 length>1 自会不渲染卡片）');
  assert.equal(
    out.colorMode,
    'pace',
    '只有 1 个海拔点时 buildAltitudePolyline 段内 <2 会 continue，一条线都画不出来',
  );
});

test('CM3 白名单外的类型有海拔也按配速（曲线与着色共用一条白名单）', async () => {
  const out = await load('running', track(8, 8));
  assert.equal(out.chartLen, 0);
  assert.equal(out.colorMode, 'pace');
});

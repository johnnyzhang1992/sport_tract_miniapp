/**
 * 详情页「约 X 公里疑似搭车，未计入」这句改由接口下发（活动 DTO 的 vehicleNotice），端上不再自己拼。
 *
 * 原先这句在页面里现算：段数从点标记数、时长取 vehicleMs、位移取 vehicleM，
 * 于是 webAdmin 想显示同一句只能再抄一遍（它当时只画了灰线没这句）。
 * 这里喂一条「接口有文案、本地量全是 0/没标记」的轨迹：
 * 端上要是还在自己拼，拼出来的必是空串，UI 就没这句话了 —— 断言透传的必须就是接口那句。
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

const NOTICE = '约 2.00 公里疑似搭车，未计入';

test('VN1 接口文案原样透传：本地量全 0 也不影响这句话出现在页面上', async () => {
  api.get = async () => ({
    id: 'act_notice',
    type: 'running',
    trackPoints: [
      { seq: 1, lat: 30, lng: 120, timestamp: 1760000000000, altitude: null },
      { seq: 2, lat: 30.002, lng: 120, timestamp: 1760000060000, altitude: null },
      { seq: 3, lat: 30.004, lng: 120, timestamp: 1760000120000, altitude: null },
    ],
    markers: [],
    startTime: 1760000000000,
    endTime: 1760000120000,
    duration: 120,
    totalDuration: 120,
    distance: 400,
    avgPace: 300,
    calories: 30,
    elevationGain: 0,
    status: 'finished',
    vehicleMs: 0,
    vehicleM: 0,
    vehicleNotice: NOTICE,
  });
  const set = {};
  const self = {
    data: { id: 'act_notice', mapType: 'standard', activity: null, markerList: [] },
    setData: (patch) => Object.assign(set, patch),
  };
  for (const [k, v] of Object.entries(page)) {
    if (typeof v === 'function') self[k] = v.bind(self);
  }
  await page.loadDetail.call(self);
  assert.equal(set.activity.vehicleNotice, NOTICE, '页面拿到的必须是接口那句（本地重算会得到空串）');
  assert.equal(set.vehicleNote, undefined, '端上不再自己拼句：留着这条路径迟早和接口文案分叉');
  assert.equal(set.vehicleSpans, undefined, '段数也不再本地数（接口那句里已带）');
});

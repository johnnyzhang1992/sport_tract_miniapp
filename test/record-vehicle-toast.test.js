/**
 * 录入端「疑似乘车」toast 回归（pages/record/record.js#onVehicle）
 * 只抓 Page() 工厂、用假 this 调这一个方法：不建活动、不真录，断的是文案口径与"每段一次"的接线点。
 * 跑法：node --test test/record-vehicle-toast.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

let page = null;
const toasts = [];
global.wx = {
  getStorageSync: () => '',
  setStorageSync() {},
  removeStorageSync() {},
  showToast(o) {
    toasts.push(o);
  },
  vibrateShort() {},
  getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667 }),
  getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667 }),
  createMapContext: () => ({}),
};
global.getApp = () => ({ globalData: {}, hasSession: () => false });
global.Page = (o) => {
  page = o;
};
require('../miniprogram/pages/record/record.js');

const fire = (info) => {
  toasts.length = 0;
  // 假 this 只带这一个方法要用的两样：data 与同页的 fmtDur（不整页挂起来）
  page.onVehicle.call({ data: {}, fmtDur: page.fmtDur }, info);
  return toasts[0];
};

test('toast 文案带实际速度与时长（不是笼统一句"速度过快"）', () => {
  const t = fire({ runSec: 62, avgMps: 7.2 }); // 7.2 m/s = 25.9 km/h
  assert.ok(t, 'onVehicle 应弹 toast');
  assert.equal(t.icon, 'none');
  assert.match(t.title, /26 km\/h/, `应带换算后的实际速度，实际「${t.title}」`);
  assert.match(t.title, /01:02/, `应带已持续的时长，实际「${t.title}」`);
  assert.match(t.title, /疑似搭车/, `用词要与详情页图例、接口文案一致，实际「${t.title}」`);
  assert.match(t.title, /未计入/, '要讲清后果，否则用户以为只是提醒一下');
});

test('60 秒整的边界文案不出现 00:60 这种没进位的秒', () => {
  const t = fire({ runSec: 60, avgMps: 6.6 });
  assert.match(t.title, /01:00/, `实际「${t.title}」`);
  assert.doesNotMatch(t.title, /:60/);
});

/**
 * 轨迹详情页：分享海报的「运动数据」不含打点（详情页那张网格保留）
 *
 * 海报与详情页网格共用同一份 metrics 数组，打点只在详情页有意义（能点进去编辑），
 * 分享出去对看的人只是一格无意义的数字。只 require 页面模块、直接调这个纯方法。
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

test('PM1 去掉打点这一项，其余项与顺序原样保留', () => {
  const metrics = [
    { label: '运动时长', value: '12:00' },
    { label: '运动消耗', value: '120', unit: '千卡' },
    { label: '打点', value: '3', unit: '个' },
    { label: '爬升高度', value: '20', unit: '米' },
  ];
  const poster = page.posterMetricsOf(metrics);
  assert.deepEqual(poster.map((m) => m.label), ['运动时长', '运动消耗', '爬升高度']);
  assert.equal(metrics.length, 4, '不能就地改掉原数组——详情页那张网格读的还是它');
});

test('PM2 没有打点时原样返回：不误伤别的项', () => {
  const metrics = [
    { label: '运动时长', value: '1:00' },
    { label: '总时长', value: '1:30' },
    { label: '平均配速', value: "5'30\"" },
  ];
  assert.deepEqual(page.posterMetricsOf(metrics).map((m) => m.label), ['运动时长', '总时长', '平均配速']);
});

test('PM3 空数组/未定义不炸', () => {
  assert.deepEqual(page.posterMetricsOf([]), []);
  assert.deepEqual(page.posterMetricsOf(undefined), []);
});

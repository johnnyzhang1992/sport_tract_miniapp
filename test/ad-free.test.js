/**
 * utils/ad-free：免广告权益的端上缓存与订阅。
 * 真值来自服务端（login 的 user.adFreeUntil / summary.adFreeUntil），这里只负责落盘、判定与通知。
 * 运行：npm test（node --test 自动发现）；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const storage = new Map();
global.wx = {
  getStorageSync: (k) => (storage.has(k) ? storage.get(k) : ''),
  setStorageSync: (k, v) => { storage.set(k, v); },
};
const adFree = require('../miniprogram/utils/ad-free.js');

test('AF1 默认没有免广告权益', () => {
  storage.clear();
  assert.equal(adFree.getAdFreeUntil(), 0);
  assert.equal(adFree.isAdFree(1000), false);
});

test('AF2 到期时刻落盘：到期前免广告、到期当刻已恢复；冷启动读的也是落盘值', () => {
  storage.clear();
  adFree.setAdFreeUntil(5000);
  assert.equal(adFree.getAdFreeUntil(), 5000);
  assert.equal(adFree.isAdFree(4999), true);
  assert.equal(adFree.isAdFree(5000), false, '到期时刻当刻已失效');
  assert.equal(storage.get('ad_free_until'), 5000, '必须落盘，否则重启小程序就忘了');
});

test('AF3 状态变化通知订阅者：值没变不重复通知，退订后不再收到', () => {
  storage.clear();
  const seen = [];
  const off = adFree.onAdFreeChange((ts) => seen.push(ts));
  adFree.setAdFreeUntil(1000);
  adFree.setAdFreeUntil(1000);
  adFree.setAdFreeUntil(0);
  off();
  adFree.setAdFreeUntil(2000);
  assert.deepEqual(seen, [1000, 0]);
});

test('AF4 脏数据一律当没有权益（字符串/负数都不能把人当免广告）', () => {
  storage.clear();
  storage.set('ad_free_until', 'oops');
  assert.equal(adFree.getAdFreeUntil(), 0);
  storage.set('ad_free_until', -5);
  assert.equal(adFree.isAdFree(0), false);
});

test('AF5 两处接线都写缓存：登录响应的 user.adFreeUntil、积分页 summary 的 adFreeUntil', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const app = fs.readFileSync(path.join(__dirname, '../miniprogram/app.js'), 'utf8');
  assert.ok(/setAdFreeUntil\(data\.user && data\.user\.adFreeUntil\)/.test(app),
    '启动静默登录要把 user.adFreeUntil 写进缓存（否则广告组件不知道有权益）');
  const points = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/points/points.js'), 'utf8');
  assert.ok(/setAdFreeUntil\(data\.adFreeUntil\)/.test(points),
    '积分页拉到 summary 也要写（兑换/激活后回到本页即生效）');
});

/**
 * 首页广告每日展示上限（冷启动口径）。
 * 规则：同一用户同一天最多展示 3 次，冷启动 onLaunch 每次记 1 次；
 * 切 tab / 从其它页返回首页不计数（同一次运行内不再变）。
 * 存储：本地 storage，按「登录用户 ID + 东八区日期」记，游客按设备（uid 空）记。
 * 运行：npm test（node --test 自动发现）；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const storage = new Map();
global.wx = {
  getStorageSync: (k) => (storage.has(k) ? storage.get(k) : ''),
  setStorageSync: (k, v) => { storage.set(k, v); },
  removeStorageSync: (k) => { storage.delete(k); },
  base64ToArrayBuffer: (b64) => Buffer.from(b64, 'base64'),
};

const cap = require('../miniprogram/utils/ad-cap.js');

const DAY = 24 * 3600 * 1000;
// 东八区 2026-11-12 10:00
const T0 = Date.UTC(2026, 10, 12, 2, 0, 0);

test('CAP1 同一天第 1~3 次冷启动允许，第 4 次起拦截', () => {
  storage.clear();
  assert.equal(cap.recordLaunch('u1', T0), true, '第 1 次');
  assert.equal(cap.recordLaunch('u1', T0 + 1000), true, '第 2 次');
  assert.equal(cap.recordLaunch('u1', T0 + 2000), true, '第 3 次');
  assert.equal(cap.recordLaunch('u1', T0 + 3000), false, '第 4 次应拦');
});

test('CAP2 跨东八区自然日后重置计数', () => {
  storage.clear();
  for (let i = 0; i < 4; i++) cap.recordLaunch('u1', T0 + i * 1000);
  assert.equal(cap.recordLaunch('u1', T0 + DAY), true, '次日第 1 次应重新允许');
});

test('CAP3 同一天换登录用户各自独立计数', () => {
  storage.clear();
  for (let i = 0; i < 4; i++) cap.recordLaunch('u1', T0 + i * 1000);
  assert.equal(cap.recordLaunch('u2', T0 + 5000), true, '另一个用户当天第 1 次应允许');
});

test('CAP4 游客（空 uid）与登录用户分开计数', () => {
  storage.clear();
  for (let i = 0; i < 4; i++) cap.recordLaunch('', T0 + i * 1000);
  assert.equal(cap.recordLaunch('', T0 + 5000), false, '游客第 4 次应拦');
  assert.equal(cap.recordLaunch('u1', T0 + 6000), true, '登录用户不受游客计数影响');
});

test('CAP5 存储是坏数据/缺字段时按当天首次处理', () => {
  storage.clear();
  storage.set(cap.STORAGE_KEY, 'broken');
  assert.equal(cap.recordLaunch('u1', T0), true);

  storage.set(cap.STORAGE_KEY, { date: '2026-11-12', uid: 'u1' });
  assert.equal(cap.recordLaunch('u1', T0 + 1000), true, 'count 缺失按 0 起算，仍允许');
});

test('CAP6 JWT payload 里解出 userId；无 token/坏 token 视为游客', () => {
  const payload = Buffer.from(JSON.stringify({ userId: 'u-42' }))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  assert.equal(cap.userIdFromToken(`a.${payload}.c`), 'u-42');
  assert.equal(cap.userIdFromToken(''), '');
  assert.equal(cap.userIdFromToken('bad.token'), '');
});

test('CAP7 接线：onLaunch 记一次，首页按 homeAdAllowed 传 blocked', () => {
  const root = path.join(__dirname, '..');
  const appJs = fs.readFileSync(path.join(root, 'miniprogram/app.js'), 'utf8');
  assert.match(appJs, /recordLaunch\(/, 'app.onLaunch 必须记录一次冷启动');
  assert.match(appJs, /homeAdAllowed/, '启动结果要存进 globalData 给首页用');

  const wxml = fs.readFileSync(path.join(root, 'miniprogram/pages/index/index.wxml'), 'utf8');
  assert.match(
    wxml,
    /<ad-template[^>]*adslot="home_bottom"[^>]*blocked="\{\{!homeAdAllowed\}\}"/,
    '首页广告要按 homeAdAllowed 传 blocked',
  );
});

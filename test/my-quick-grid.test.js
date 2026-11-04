/**
 * 「我的」页四等分快捷卡（2026-11-04）：
 * - 用户卡与运动报告之间新增 消息 / 积分 / 会员 / 设置 四列；
 * - 下方菜单移除这四个入口，只留 轨迹合集 / 足迹 / 数据导入 / 数据导出；
 * - 未读角标跟消息入口一起搬到快捷卡；会员状态副标题随菜单入口一起撤除。
 * 运行：node --test test/my-quick-grid.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const wxml = read('miniprogram/pages/my/my.wxml');
const js = read('miniprogram/pages/my/my.js');

function quickBlock() {
  const start = wxml.indexOf('class="card quick-card"');
  assert.ok(start > 0, '应有四等分快捷卡');
  const end = wxml.indexOf('<!-- 运动报告', start);
  assert.ok(end > start, '快捷卡应在运动报告之前');
  return wxml.slice(start, end);
}

test('QG1 快捷卡四等分：消息/积分/会员/设置，顺序固定', () => {
  const block = quickBlock();
  const labels = [];
  const re = />([^<>{}]+)</g;
  let m;
  while ((m = re.exec(block))) {
    const t = m[1].trim();
    if (t) labels.push(t);
  }
  assert.deepEqual(labels, ['消息', '积分', '会员', '设置']);
  assert.equal((block.match(/class="quick-item"/g) || []).length, 4, '四列等分');
  assert.match(block, /bindtap="goNotifications"[\s\S]*>消息</);
  assert.match(block, /bindtap="goPoints"[\s\S]*>积分</);
  assert.match(block, /bindtap="goMember"[\s\S]*>会员</);
  assert.match(block, /bindtap="goSettings"[\s\S]*>设置</);
});

test('QG2 未读角标跟消息入口搬到快捷卡', () => {
  const block = quickBlock();
  assert.match(block, /class="quick-badge" wx:if="\{\{unreadCount > 0\}\}"/);
  assert.ok(block.includes('lucide-bell.png'));
  assert.ok(read('miniprogram/pages/my/my.wxss').includes('.quick-badge'));
  assert.ok(js.includes("api.get('/notifications/summary')"), '未读数仍要拉');
});

test('QG3 下方菜单移除四入口，只留轨迹合集/足迹/数据导入/数据导出', () => {
  const start = wxml.indexOf('<t-cell-group');
  const end = wxml.indexOf('</t-cell-group>', start);
  const menu = wxml.slice(start, end);
  const titles = [...menu.matchAll(/(?:^|\s)title="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(titles, ['轨迹合集', '足迹', '数据导入', '数据导出']);
  for (const old of ['我的积分', '会员中心', '消息中心', '设置']) {
    assert.ok(!menu.includes(`title="${old}"`), `菜单不应再有${old}`);
  }
});

test('QG4 会员状态副标题随入口撤除；权益接口只服务头像徽标', () => {
  assert.ok(!wxml.includes('memberHint'));
  assert.ok(!wxml.includes('member-hint'));
  assert.ok(!js.includes('memberHint'));
  assert.match(
    js,
    /api\.get\('\/member\/entitlements'\)/,
    '头像会员徽标仍需读 memberActive，但只保存布尔，不再拼副标题',
  );
});

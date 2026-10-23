/**
 * 占位圆首字（miniprogram/utils/format.js 的 initialOf）与各调用点。
 *
 * 起因：昵称以 emoji 开头时 `name[0]` 取的是 UTF-16 **码元**，会留下半个代理对，
 * 头像占位圆里渲染成乱码方块。活动卡片先修（按码点取），随后点名运动榜与「我的」页
 * 是同一个写法，一起收口到共享函数——别在四个页面各写一份。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { initialOf } = require('../miniprogram/utils/format.js');

test('IO1 首字按码点取：emoji 开头不劈代理对', () => {
  assert.equal(initialOf('阿迹', '迹'), '阿');
  assert.equal(initialOf('🏃跑者', '迹'), '🏃', '码元下标会切出半个代理对');
  assert.equal(initialOf('🏃', '迹'), '🏃', '整个昵称就是一个 emoji');
  assert.equal(initialOf('', '迹'), '迹', '空昵称走缺省字');
  assert.equal(initialOf(null, '微信用户'), '微');
  assert.equal(initialOf(undefined, ''), '', '没兜底字时给空串，不吐 undefined');
});

/** 读源码（剥注释）确认写法已经换掉 */
function src(rel) {
  return fs
    .readFileSync(path.join(__dirname, '..', rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

test('IO2 运动榜与「我的」页都改用 initialOf，不再留码元下标', () => {
  const lb = src('miniprogram/pages/leaderboard/leaderboard.js');
  assert.match(lb, /avatarText: initialOf\(r\.name, '迹'\)/, '榜上三处行数据共用 avatarOf');
  assert.ok(!/\|\| '迹'\)\[0\]/.test(lb), "leaderboard 不再用 (name || '迹')[0]");

  const my = src('miniprogram/pages/my/my.js');
  assert.match(my, /avatarText: initialOf\(/, '「我的」页走共享函数');
  assert.ok(!/nickname\[0\]/.test(my), 'my 不再用 nickname[0]');

  const detail = src('miniprogram/pages/campaign-detail/campaign-detail.js');
  assert.ok(!/\|\| '迹'\)\[0\]/.test(detail), "详情页同样不再用码元下标");
});

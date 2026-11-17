/**
 * 未登录引导统一化（2026-11-17）：components/guest-hint
 *
 * 背景：接入徽章页时发现游客态有 3 种实现并存（login-hint / guest-card / login-empty），
 * 样式和文案都不一致，改一次要改五处。现在收成一个组件。
 *
 * 这些测试守两件事：
 *   1. 组件本身的 props / 事件契约
 *   2. 「不许再各写一份」——页面里不能再出现旧的游客态实现
 * 运行：node --test test/guest-hint.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../miniprogram');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* ── 组件契约 ─────────────────────────────────────── */
let def = null;
global.Component = (d) => { def = d; };
require('../miniprogram/components/guest-hint/guest-hint.js');

test('GH1 组件定义存在，且 props 齐全', () => {
  assert.ok(def, '组件未定义');
  for (const k of ['feature', 'icon', 'tip', 'compact']) {
    assert.ok(def.properties[k], `缺少 prop: ${k}`);
  }
});

test('GH2 feature 有默认值（页面忘了传也不会渲染出半句话）', () => {
  assert.equal(def.properties.feature.value, '运动数据');
});

test('GH3 点击按钮抛 login 事件，组件自己不调 app.login()', () => {
  const events = [];
  def.methods.onTapLogin.call({ triggerEvent: (n) => events.push(n) });
  assert.deepEqual(events, ['login'], '应抛 login 事件');
  // 只查真实调用（getApp().login() 或 app.login()），注释里提到不算
  const src = read('components/guest-hint/guest-hint.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/getApp\(\)\s*\.\s*login|\.login\(\)\s*\.then/.test(src), '组件不该自己调登录（登录后动作因页面而异）');
});

test('GH4 模板包含标题/副文/按钮三段，且「你的」只出现一次（防重复拼接）', () => {
  const wxml = read('components/guest-hint/guest-hint.wxml');
  assert.ok(wxml.includes('登录后查看你的{{feature}}'));
  assert.ok(wxml.includes('微信一键登录'));
  assert.equal((wxml.match(/你的/g) || []).length, 1, '「你的」重复会出现「你的我的徽章」');
});

/* ── 不许再各写一份 ───────────────────────────────── */
const MIGRATED = [
  'pages/stats/stats',
  'pages/tracks/tracks',
  'pages/report/report',
  'pages/badges/badges',
  'pages/plan-history/plan-history',
  // 积分四页（2026-11-17 补）：原来是「一行文字 + state-tap」的另一种写法
  'pages/points/points',
  'pages/points-records/points-records',
  'pages/points-exchanges/points-exchanges',
  'pages/points-item/points-item',
  // 会员中心（2026-11-17 补）
  'pages/member/member',
  // 设置页（2026-11-17 补）：游客保留运动类型设置，其余隐藏
  'pages/settings/settings',
];

test('GH5 已迁移页面都在用 guest-hint 组件', () => {
  for (const base of MIGRATED) {
    const wxml = read(`${base}.wxml`);
    assert.ok(wxml.includes('<guest-hint'), `${base} 未使用 guest-hint`);
    const json = JSON.parse(read(`${base}.json`));
    assert.ok(
      (json.usingComponents || {})['guest-hint'],
      `${base}.json 未注册 guest-hint`,
    );
  }
});

test('GH6 已迁移页面不再保留旧的游客态样式（login-hint / guest-card）', () => {
  for (const base of MIGRATED) {
    const wxss = read(`${base}.wxss`);
    assert.ok(!/^\.login-hint/m.test(wxss), `${base}.wxss 仍有 .login-hint（应删，已归组件）`);
    assert.ok(!/^\.guest-card/m.test(wxss), `${base}.wxss 仍有 .guest-card（应删，已归组件）`);
  }
});

test('GH7 已迁移页面不再有内联的游客态结构', () => {
  for (const base of MIGRATED) {
    const wxml = read(`${base}.wxml`);
    assert.ok(!wxml.includes('login-hint-btn'), `${base}.wxml 仍有旧的「去登录」按钮`);
    assert.ok(!wxml.includes('<button class="login-hint'), `${base}.wxml 仍有旧的登录按钮`);
  }
});
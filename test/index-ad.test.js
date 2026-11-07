/**
 * 首页模板广告位（adslot=home_bottom）接线测试：
 * - index.json 注册 ad-template 组件
 * - index.wxml 挂载位在「运动日历卡之后、运动榜/一起运动双格之前」（中段内容位，
 *   不挤占「运动类型选择 + 开始按钮」的核心动作区）
 * - adslot key 与后台「广告管理」的约定一致（home_bottom，模型注释里的首选惯例值）
 * 展示条件（后台在架 + 未免广告）由组件自身逻辑保证（ad-template 组件内测覆盖）。
 * 运行：npm test；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('IA1 首页注册并挂载 home_bottom 广告位', () => {
  const json = JSON.parse(read('miniprogram/pages/index/index.json'));
  assert.equal(
    json.usingComponents['ad-template'],
    '/components/ad-template/ad-template',
    'index.json 必须注册 ad-template 组件',
  );

  const wxml = read('miniprogram/pages/index/index.wxml');
  assert.match(wxml, /<ad-template adslot="home_bottom" \/>/, '挂载位必须用 home_bottom slot key');
});

test('IA2 挂载位在运动日历卡之后、运动榜/一起运动双格之前', () => {
  const wxml = read('miniprogram/pages/index/index.wxml');
  const at = wxml.indexOf('<ad-template adslot="home_bottom"');
  const calendar = wxml.indexOf('运动日历');
  const duo = wxml.indexOf('<view class="duo-row">');
  const typeSelect = wxml.indexOf('运动类型选择');
  assert.ok(calendar > 0 && duo > 0 && typeSelect > 0, '锚点卡都应存在');
  assert.ok(at > calendar, '广告应在运动日历卡之后');
  assert.ok(at < duo, '广告应在运动榜/一起运动双格之前');
  assert.ok(at < typeSelect, '广告不应挤进「运动类型选择 + 开始按钮」核心动作区');
});

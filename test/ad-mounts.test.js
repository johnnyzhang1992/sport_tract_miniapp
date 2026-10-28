/**
 * 六个投放页的接线守卫：json 注册了 ad-template、wxml 用了正确的广告位 key。
 * key 与后台「广告管理」里配置的 key 必须一字不差，否则端上取不到 unit-id（广告位静默不展示）。
 * 运行：npm test（node --test 自动发现）；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// [页面, 广告位 key, wxml 里该 key 的份数]：轨迹页列表/卡片两种展示模式各一处（同时只渲染一种）
const PAGES = [
  ['tracks', 'tracks_list', 2], // 我的轨迹（轨迹列表）：插在第 3 条之后
  ['campaign-detail', 'campaign_detail', 1], // 活动详情
  ['leaderboard', 'leaderboard', 1], // 运动榜
  ['stats', 'stats', 1], // 数据统计
  ['track-detail', 'track_detail', 1], // 轨迹详情
  ['points', 'points', 1], // 我的积分：插在签到卡与每日任务卡之间
];

for (const [page, key, count] of PAGES) {
  test(`AM ${page} 挂载模板广告位 ${key}：json 注册 + wxml 引用 key 一字不差`, () => {
    const base = path.join(__dirname, `../miniprogram/pages/${page}/${page}`);
    const json = JSON.parse(fs.readFileSync(`${base}.json`, 'utf8'));
    assert.equal(
      (json.usingComponents || {})['ad-template'],
      '/components/ad-template/ad-template',
      '页面 json 必须注册 ad-template（绝对路径）',
    );
    const wxml = fs.readFileSync(`${base}.wxml`, 'utf8');
    // 允许标签上还有 wx:if 之类的其它属性（轨迹页要按条目位置决定是否渲染）
    const hit = wxml.match(/<ad-template\b[^>]*\badslot="[a-z0-9_]+"/g) || [];
    assert.equal(hit.length, count, `该页应放 ${count} 个广告位，实际 ${hit.length} 个`);
    const tags = wxml.match(/<ad-template\b[^>]*>/g) || [];
    assert.ok(
      tags.length > 0 && tags.every((t) => t.includes(`adslot="${key}"`)),
      `广告位属性必须是 adslot="${key}"（单小写单词：属性名不转驼峰，slot 又是保留字）`,
    );
  });
}

test('AM 积分页广告位落在签到卡与每日任务卡之间（不是塞页尾当尾巴）', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/points/points.wxml'), 'utf8');
  const at = wxml.indexOf('<ad-template');
  assert.ok(at > 0, '积分页要有广告位');
  const signin = wxml.indexOf('class="card signin-card"');
  // 锚在 section-title 上而不是裸文字：页面注释里也写了「每日任务」，裸文字会先命中注释（踩过）
  const tasks = wxml.indexOf('<view class="section-title">每日任务</view>');
  assert.ok(signin >= 0 && tasks > 0 && signin < at && at < tasks, `广告位要在签到卡之后、每日任务之前（signin ${signin} / ad ${at} / tasks ${tasks}）`);
});

test('AM 组件内只用后台下发的 unit-id（端上不写死广告单元）', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/components/ad-template/ad-template.wxml'), 'utf8');
  assert.ok(!/unit-id="adunit-/.test(wxml), 'wxml 里不该出现写死的 adunit- 常量');
  const all = PAGES.map(([p]) => fs.readFileSync(path.join(__dirname, `../miniprogram/pages/${p}/${p}.wxml`), 'utf8')).join('\n');
  assert.ok(!/adunit-[0-9a-f]{16}/.test(all), '页面里也不该写死广告单元 id');
});

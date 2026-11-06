/**
 * 数据统计页「最佳记录」卡片文案（pages/stats/stats.js#decorateBest）。
 * 最快配速与轨迹详情/榜单同口径：标签已写明「配速」，值不带 /公里。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = {
  id: apiPath,
  filename: apiPath,
  loaded: true,
  exports: { get: () => Promise.resolve({}) },
  children: [],
  paths: [],
};

global.wx = {};
let pageDef = null;
global.Page = (def) => { pageDef = def; };
global.getApp = () => ({ globalData: {} });

require('../miniprogram/pages/stats/stats.js');

test('最快配速：值不带 /公里', () => {
  const best = pageDef.decorateBest({
    minPaceByType: [{ type: 'running', fastestKm: 600 }],
  });
  const card = best.bestCards.find((c) => c.label === '最快配速');
  assert.equal(card.value, `10'00"`);
});

test('最佳记录卡带保持天数：今天达成 / 已保持 N 天', () => {
  const DAY = 86400000;
  const best = pageDef.decorateBest({
    maxDistanceByType: [
      { type: 'running', distance: 5000, id: 'a', startTime: Date.now() },
    ],
    fastestDistanceByKm: [
      { type: 'running', km: 5, sec: 1500, id: 'b', startTime: Date.now() - 80 * DAY },
    ],
  });
  assert.equal(best.bestCards.find((c) => c.label === '最远距离').heldText, '今天达成');
  assert.equal(best.bestCards.find((c) => c.label === '5 公里 PB').heldText, '已保持 80 天');
});

test('最佳记录末尾追加两条步数纪录：最多步数日 / 步数最多月份', () => {
  const report = {
    overview: {
      totalStep: 23000, avgStep: 4600, bestDate: '2026-02-10', bestStep: 12000, syncedDays: 5, days: 62,
    },
    months: [],
    bestMonth: { month: '2026-02', step: 15000 },
  };
  const best = pageDef.decorateBest({
    maxDistanceByType: [{ type: 'running', distance: 5000, id: 'a', startTime: Date.now() }],
  }, report);
  const stepCards = best.bestCards.slice(-2);
  assert.deepEqual(stepCards.map((c) => c.label), ['最多步数日', '步数最多月份']);
  assert.equal(stepCards[0].value, '1.2万 步');
  assert.equal(stepCards[0].typeLabel, '微信步数');
  assert.equal(stepCards[0].heldText, '2026/02/10');
  assert.equal(stepCards[0].id, '', '没有轨迹可跳');
  assert.equal(stepCards[0].icon, '/assets/icons/lucide-footprints.png');
  assert.equal(stepCards[1].heldText, '2026年2月');
  assert.equal(stepCards[1].icon, '/assets/icons/lucide-calendar-blue.png');
});

test('没有运动 PB 但有步数：最佳记录仍返回步数卡；两者都没有则整块隐藏', () => {
  const report = {
    overview: { bestStep: 9000, bestDate: '2026-03-02', syncedDays: 1 },
    bestMonth: { month: '2026-03', step: 9000 },
  };
  const onlyStep = pageDef.decorateBest(null, report);
  assert.equal(onlyStep.bestCards.length, 2);

  assert.equal(pageDef.decorateBest(null, null), null);
  assert.equal(pageDef.decorateBest(null, { overview: { syncedDays: 0 } }), null);
});

test('半屏打开时藏掉点亮地图画布，底部卡片不被 canvas 压住', () => {
  assert.match(read('pages/stats/stats.wxml'), /<lit-map[^>]*blank="\{\{sheetVisible\}\}"/);
  assert.match(
    read('packageFootprint/components/lit-map/lit-map.wxml'),
    /provinceModal \|\| blank \? 'map-hidden'/,
  );
});

test('累计概览：时长转小时/天，爬升与千卡加千分位', () => {
  const section = { distance: 0, duration: 0, count: 0, elevationGain: 0, calories: 0 };
  const o = {
    today: section,
    week: section,
    month: section,
    year: section,
    total: { distance: 250230, duration: 793 * 3600 + 35 * 60, count: 52, elevationGain: 5472, calories: 16982, activeDays: 38 },
    prevWeek: section,
    prevMonth: section,
  };
  const d = pageDef.decorateOverview(o);
  assert.equal(d.total.durationText, '793.6小时');
  assert.equal(d.total.elevationGainText, '5,472');
  assert.equal(d.total.caloriesText, '16,982');
});

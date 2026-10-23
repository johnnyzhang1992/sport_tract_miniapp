/**
 * 数据统计页「最佳记录」卡片文案（pages/stats/stats.js#decorateBest）。
 * 最快配速与轨迹详情/榜单同口径：标签已写明「配速」，值不带 /公里。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

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

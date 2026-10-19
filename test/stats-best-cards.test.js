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

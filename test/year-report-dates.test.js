/**
 * 年度报告日期口径（pages/year-report/year-report.js）：
 * 高光记录与今年新解锁都展示完整年月日，用 / 分隔并补零：YYYY/MM/DD。
 * 页面与海报共用同一份 sub/date 文案。
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

require('../miniprogram/pages/year-report/year-report.js');

const at = (y, m, d) => new Date(y, m - 1, d, 8, 0).getTime();

test('最佳记录日期：完整年月日 + 补零', () => {
  const report = pageDef.buildReport.call({ dayKey: pageDef.dayKey }, [
    { id: 'a', type: 'running', startTime: at(2026, 9, 29), distance: 1000, duration: 600, fastestKm: 300 },
  ], { count: 1 });
  assert.equal(report.highlights[0].sub, '2026/09/29');
});

test('新解锁日期：完整年月日 + 补零', () => {
  const items = pageDef.buildMilestones.call({ md: pageDef.md }, {
    newProvinces: [{ name: '上海市', firstAt: at(2026, 3, 5) }],
  });
  assert.equal(items[0].date, '2026/03/05');
});

/**
 * 统计页与报告页的分工（口径不重复、不互相误读）：
 * 周期对比只在报告页（「本期 vs 上期」是报告的语义），统计页只留累计看板；
 * 两页都有的板块，标题必须写清口径（累计 / 本期哪一段 / 历史）。
 * 运行：npm test；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', rel), 'utf8');
const statsWxml = read('pages/stats/stats.wxml');
const statsJs = read('pages/stats/stats.js');
const reportWxml = read('pages/report/report.wxml');
const reportJs = read('pages/report/report.js');

test('周期对比只留在报告页，统计页不再重复一份', () => {
  assert.ok(!statsWxml.includes('周期对比'), '统计页不该再有周期对比卡片');
  assert.ok(!statsJs.includes('buildCompare'), '统计页的周期对比代码要一并撤掉');
  assert.ok(reportWxml.includes('周期对比'), '报告页保留周期对比');
});

test('两页同板块标题带口径', () => {
  assert.ok(statsWxml.includes('>累计分类型汇总<'), '统计页那份是全站累计');
  assert.ok(
    reportWxml.includes("分类型汇总 · {{periodLabel || '全部'}}"),
    '报告页那份只算当前查看的周期，标题要带周期文案',
  );
});

test('历史最佳只在统计页看，报告页不放也不请求', () => {
  assert.ok(!reportWxml.includes('历史最佳'), '报告页不该再挂一份累计 PB');
  assert.ok(!reportJs.includes("'/stats/best'"), '报告页的累计 PB 请求一并撤掉');
  assert.ok(statsWxml.includes('>最佳记录<'), '统计页保留最佳记录');
});

/**
 * 统计页与报告页的分工（口径不重复、不互相误读）：
 * - 完整的「周期对比」卡只在报告页（次数/距离/时长三项 + 上期值）；
 * - 统计页只在今日/本周/本月那行挂「距离」一项的轻量环比（±% 徽标），不再做整卡；
 * - 两页都有的板块，标题必须写清口径（累计 / 本期哪一段 / 历史）。
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

test('完整周期对比只在报告页；统计页只保留距离的轻量环比', () => {
  assert.ok(!statsWxml.includes('周期对比'), '统计页不该再有周期对比卡片');
  assert.ok(!statsJs.includes('buildCompare'), '统计页的整卡对比代码不要回来');
  assert.ok(statsJs.includes('calcDiff'), '统计页允许用 calcDiff 做单指标环比徽标');
  assert.ok(!statsWxml.includes('cmp-row'), '统计页不要复用报告页的对比行结构');
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

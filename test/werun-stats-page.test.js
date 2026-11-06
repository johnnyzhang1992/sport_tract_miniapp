const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('WSP-1 页面注册与入口：步数榜头部可进步数统计', () => {
  const appJson = JSON.parse(read('miniprogram/app.json'));
  assert.ok(appJson.pages.includes('pages/werun-stats/werun-stats'), '页面必须在 app.json 注册');
  const board = read('miniprogram/pages/werun-board/werun-board.wxml');
  assert.match(board, /bindtap="goStats"[\s\S]{0,40}统计/, '步数榜头部要有统计入口');
  const boardJs = read('miniprogram/pages/werun-board/werun-board.js');
  assert.match(boardJs, /\/pages\/werun-stats\/werun-stats/, 'goStats 跳到统计页');
});

test('WSP-2 结构：四个时间档 + 概况 + 柱状趋势 + 每日明细分页', () => {
  const js = read('miniprogram/pages/werun-stats/werun-stats.js');
  for (const label of ['7日', '30日', '半年', '一年']) {
    assert.ok(js.includes(`label: '${label}'`), `时间档要有 ${label}`);
  }
  const wxml = read('miniprogram/pages/werun-stats/werun-stats.wxml');
  assert.match(wxml, /wx:for="\{\{ranges\}\}"/, '时间档分段');
  assert.match(wxml, /总步数[\s\S]*日均步数[\s\S]*最高单日[\s\S]*同步天数/, '概况四项');
  assert.match(wxml, /<stat-chart[\s\S]*type="bar"[\s\S]*unit="step"/, '趋势要用柱状图且单位是步');
  assert.match(wxml, /wx:for="\{\{days\}\}"/, '每日明细列表');
  assert.match(wxml, /item\.stepText/, '每日明细行展示步数');
  // 失败态优先：先判断「加载失败，点击重试」，正常态才走「加载更多」
  assert.match(wxml, /dayHasMore && dayLoadError[\s\S]{0,160}点击重试/, '分页失败要有可点的重试入口');
  assert.match(wxml, /wx:elif="\{\{dayHasMore\}\}"[\s\S]{0,120}loadMoreDays/, '分页加载更多');
  assert.match(wxml, /已显示 \{\{days\.length\}\} \/ \{\{dayTotal\}\}/, '分页进度');
});

test('WSP-3 请求与时间档：stats/days 都带 range，明细按页追加', () => {
  const js = read('miniprogram/pages/werun-stats/werun-stats.js');
  assert.match(js, /\/werun\/stats\?range=\$\{range\}/);
  assert.match(js, /\/werun\/days\?range=\$\{range\}&page=1&pageSize=/);
  assert.match(js, /page=\$\{dayPage \+ 1\}/, '加载更多要取下一页');
  assert.match(js, /dayPage: d\.page \|\| dayPage \+ 1/, '页码以服务端为准');
  assert.match(js, /dayHasMore: !!d\.hasMore/);
});

test('WSP-4 统计 tab 小卡片：近 7 天概况 + 跳转步数统计页', () => {
  const wxml = read('miniprogram/pages/stats/stats.wxml');
  const js = read('miniprogram/pages/stats/stats.js');
  assert.match(wxml, /步数统计[\s\S]{0,200}bindtap="goWerunStats"/, '统计页要有步数统计入口卡');
  assert.match(wxml, /stepCard[\s\S]{0,80}totalText/, '卡片展示近 7 天总步数');
  assert.match(js, /\/werun\/stats\?range=7/, '概况数据走步数统计接口');
  assert.match(js, /goWerunStats\(\)[\s\S]{0,100}\/pages\/werun-stats\/werun-stats/, '点击进入步数统计页');
});

test('WSP-5 步数统计页趋势变化卡：30 天对比 + 与统计页同款两列小卡', () => {
  const wxml = read('miniprogram/pages/werun-stats/werun-stats.wxml');
  const js = read('miniprogram/pages/werun-stats/werun-stats.js');
  assert.match(wxml, /趋势变化[\s\S]{0,80}近 30 天 vs 前 30 天/, '变化卡区块');
  assert.match(wxml, /wx:for="\{\{stepMetricCards\}\}"/, '四张变化卡');
  assert.match(wxml, /metric-label/, '小卡带头像图标与名目');
  assert.match(js, /\/werun\/stats\?range=30&compare=1/, '对比数据要带 compare=1');
  assert.match(js, /buildStepMetricCards/, '卡片数据由纯函数生成');
});

test('WSP-6 加载更多失败：保留已加载内容、置错误态（底部可重试），成功一次后清除', () => {
  const js = read('miniprogram/pages/werun-stats/werun-stats.js');
  assert.match(js, /dayLoadError: true/, '失败要置错误态');
  assert.match(js, /dayLoadError: false/, '成功/切档要清除错误态');
  assert.ok(!/加载更多失败[\s\S]{0,80}wx\.showToast/.test(js), '失败不再只靠 toast（一瞬即逝，用户没有第二次机会）');
});

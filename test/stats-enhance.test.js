/**
 * 统计页增强：近 90 天 vs 近 365 天日均对比、里程碑奖杯墙。
 * 都是纯函数，边界口径直接写进用例。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildTrophies } = require('../miniprogram/utils/trophy.js');

/** 造 n 天数据：valueFn(i) 返回当天距离（米），按时间升序 */
function days(n, valueFn) {
  return Array.from({ length: n }, (_, i) => ({
    date: `d${i}`,
    distance: valueFn(i),
    duration: 0,
    count: 0,
  }));
}

test('TR1 奖杯墙固定五项，已达成的带轨迹 id', () => {
  const list = buildTrophies([
    { key: '1k', id: 'a', sec: 280, type: 'running' },
    { key: '5k', id: 'b', sec: 1500, type: 'running' },
  ]);
  assert.deepEqual(
    list.map((t) => t.key),
    ['1k', '5k', '10k', 'half', 'full'],
  );
  assert.deepEqual(
    list.map((t) => t.unlocked),
    [true, true, false, false, false],
  );
  assert.equal(list[0].id, 'a');
  assert.equal(list[0].sec, 280);
  assert.equal(list[2].id, '');
  assert.equal(list[2].sec, 0);
});

test('TR2 空数据全部未解锁；未知 key 忽略', () => {
  assert.ok(buildTrophies([]).every((t) => !t.unlocked));
  const list = buildTrophies([{ key: 'mile', id: 'x', sec: 1 }]);
  assert.equal(list.length, 5);
  assert.ok(list.every((t) => !t.unlocked));
});

test('TR3 奖杯附解锁要求与保持天数', () => {
  const now = Date.UTC(2026, 9, 23);
  const DAY = 86400000;
  const list = buildTrophies(
    [{ key: '5k', id: 'b', sec: 1500, type: 'running', startTime: now - 80 * DAY }],
    now,
  );
  const byKey = new Map(list.map((t) => [t.key, t]));
  assert.equal(byKey.get('5k').heldDays, 80);
  assert.equal(byKey.get('5k').startTime, now - 80 * DAY);
  assert.equal(byKey.get('5k').requirementText, '完成 5 km');
  assert.equal(byKey.get('1k').requirementText, '完成 1 km');
  assert.equal(byKey.get('10k').requirementText, '完成 10 km');
  assert.equal(byKey.get('half').requirementText, '完成 21.1 km');
  assert.equal(byKey.get('full').requirementText, '完成 42.2 km');
});

test('TR4 保持天数：未来时间/缺失时间按 0，不出现负数', () => {
  const now = Date.UTC(2026, 9, 23);
  const DAY = 86400000;
  const list = buildTrophies(
    [
      { key: '1k', id: 'a', sec: 300, type: 'running', startTime: now + DAY },
      { key: '5k', id: 'b', sec: 1500, type: 'running' },
    ],
    now,
  );
  assert.equal(list[0].heldDays, 0);
  assert.equal(list[1].heldDays, 0);
});
test('TS1 趋势区在里程碑奖杯上方，且页内不再有内嵌柱状图', () => {
  const src = require('fs')
    .readFileSync(require('path').join(__dirname, '../miniprogram/pages/stats/stats.wxml'), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '');
  const trend = src.indexOf('运动趋势');
  const trophy = src.indexOf('里程碑奖杯');
  assert.ok(trend >= 0 && trophy >= 0, '两块都在');
  assert.ok(trend < trophy, '运动趋势必须在里程碑奖杯之前');

  // 图表只住在半屏里：页面主体不能再直接渲染 stat-chart
  const sheetAt = src.indexOf('sheet-mask');
  const charts = [...src.matchAll(/<stat-chart/g)].map((m) => m.index);
  assert.equal(charts.length, 1, '全页只应有半屏里那一个图表');
  assert.ok(charts[0] > sheetAt, '图表在半屏内，不在页面主体');
  assert.ok(!/trend-compare|tc-arrow/.test(src), '90d/365d 对比块已被五张卡取代');
  assert.ok(!/metric-btn/.test(src), '半屏里不再有「距离/时长/次数」指标胶囊（卡即指标）');
});

test('TS2 五张卡可点：data-key 绑 openTrendSheet，半屏按卡指标出图', () => {
  const src = require('fs')
    .readFileSync(require('path').join(__dirname, '../miniprogram/pages/stats/stats.wxml'), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '');
  assert.match(src, /wx:for="\{\{metricCards\}\}"[\s\S]*?data-key="\{\{item\.key\}\}"[\s\S]*?bindtap="openTrendSheet"/,
    '卡片的 data-key 与点击处理都在');
  assert.match(src, /sheetType === 'trend'/, '半屏有 trend 分支');
  assert.match(src, /data="\{\{sheetTrend\.data\}\}"/, '柱状图吃的是当前指标的数据');

  const js = require('fs').readFileSync(require('path').join(__dirname, '../miniprogram/pages/stats/stats.js'), 'utf8');
  assert.match(js, /const \{[^}]*buildMetricCards[^}]*buildTrendChart[^}]*\} = require\('\.\.\/\.\.\/utils\/stats-metrics'\)/,
    '页面用共享纯函数算卡与图');
  assert.ok(!/trend-compare/.test(js), '旧的 90d/365d 工具已下线');
});

test('TS3 五张卡固定「全部类型」：半屏切类型只影响图，不改变卡片', () => {
  const js = require('fs').readFileSync(require('path').join(__dirname, '../miniprogram/pages/stats/stats.js'), 'utf8');
  const dailyGets = [...js.matchAll(/api\.get\((['`])\/stats\/trend\?days=365/g)];
  assert.ok(dailyGets.length >= 2, '首屏与切换各拉一次 365 天序列');
  // 卡片数据源不许拼 activityType，否则卡片会跟着半屏筛选变
  assert.ok(!/\/stats\/trend\?days=365\$\{/.test(js), '卡片序列不带 activityType 插值');
});

test('TS5 趋势区七张卡共用一套内构：左圆圈图标 + 右侧三行左对齐', () => {
  const src = require('fs')
    .readFileSync(require('path').join(__dirname, '../miniprogram/pages/stats/stats.wxml'), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '');
  const count = (re) => (src.match(re) || []).length;

  // 七张卡 = 趋势卡模板 1 份 + 本周/本月 2 份，每份都是同一套部件
  ['metric-badge', 'metric-body', 'metric-label', 'metric-value-line', 'metric-foot'].forEach((cls) => {
    assert.equal(count(new RegExp('class="' + cls + '[" ]', 'g')), 3, cls + ' 应是 3 份（趋势模板 + 本周 + 本月）');
  });
  // 旧内构与周期格专属结构都该清掉
  assert.ok(!/metric-head|metric-main|metric-arrow|period-head|period-num|period-label|period-diff/.test(src), '旧内构已清干净');

  // 顺序：圆圈 → 名目 → 数值 → 涨跌（都在同一张卡里自上而下）
  const order = ['metric-badge', 'metric-label', 'metric-value', 'metric-foot'].map((c) => src.indexOf('class="' + c));
  assert.ok(order.every((v, i) => i === 0 || v > order[i - 1]), '顺序：圆圈图标 → 名目 → 数值 → 涨跌');
});

test('TS4 趋势卡的箭头是 lucide 图标，不是文字箭头', () => {
  const fs = require('fs');
  const path = require('path');
  const wxml = fs
    .readFileSync(path.join(__dirname, '../miniprogram/pages/stats/stats.wxml'), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '');
  assert.match(wxml, /<view class="metric-badge">[\s\S]*?<image[^>]*src="\{\{item\.arrowIcon\}\}"/, '箭头用 image 渲染在圆圈里');
  assert.ok(!/\{\{item\.arrow\}\}/.test(wxml), '不再渲染文字箭头');

  // 卡片实际给出的三个字形都得在包里（路径从视图模型里取，改常量也能抓到），缺一个就是线上空白
  const { buildMetricCards } = require('../miniprogram/utils/stats-metrics.js');
  const day = (o) => ({ date: 'd', distance: 0, duration: 0, count: 0, calories: 0, standstillMs: 0, ...o });
  const rows = (prevD, nowD) => [
    day({ distance: prevD }),
    ...Array.from({ length: 28 }, () => day({})),
    day({ distance: nowD }),
    ...Array.from({ length: 29 }, () => day({})),
  ];
  const iconOf = (prevD, nowD) => buildMetricCards(rows(prevD, nowD)).find((c) => c.key === 'distance').arrowIcon;
  const upIcon = iconOf(100000, 200000);
  const downIcon = iconOf(100000, 50000);
  const flatIcon = iconOf(100000, 101000);
  // 方向与字形必须对上：对调会让「涨」显示红色向下，比缺图更难发现
  assert.match(upIcon, /trending-up/, '涨＝trending-up');
  assert.match(downIcon, /trending-down/, '降＝trending-down');
  assert.match(flatIcon, /minus/, '持平＝minus');
  const uniq = [...new Set([upIcon, downIcon, flatIcon])];
  assert.equal(uniq.length, 3, '上/下/持平三种图标都要有');
  uniq.forEach((rel) => {
    const p = path.join(__dirname, '..', 'miniprogram', rel);
    assert.ok(fs.existsSync(p), `缺图标 ${rel}`);
    assert.ok(fs.statSync(p).size > 0, `${rel} 是空文件`);
  });
});

test('TS6 运动日历卡：三格数字在上、月历在下，可翻月、7 列、有运动打勾', () => {
  const fs = require('fs');
  const path = require('path');
  const wxml = fs
    .readFileSync(path.join(__dirname, '../miniprogram/pages/stats/stats.wxml'), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '');
  // 日历必须在「运动日历」这张卡里（连续/最长/分位三格之下的同一张卡）
  const cardStart = wxml.indexOf('运动日历');
  const trendStart = wxml.indexOf('运动趋势');
  const calAt = wxml.indexOf('cal-head');
  assert.ok(cardStart >= 0 && calAt > cardStart && calAt < trendStart, '日历在运动日历卡内、运动趋势之前');
  assert.match(wxml, /bindtap="onCalPrev"/, '上一月');
  assert.match(wxml, /bindtap="onCalNext"/, '下一月');
  assert.match(wxml, /wx:for="\{\{calWeekdays\}\}"/, '周标题来自数据（7 列）');
  assert.match(wxml, /wx:if="\{\{cell\.hasActivity\}\}"[^>]*class="cal-check/, '有运动的天打勾');

  const js = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/stats/stats.js'), 'utf8');
  assert.match(js, /const \{[^}]*buildMonthGrid[^}]*\} = require\('\.\.\/\.\.\/utils\/activity-calendar'\)/, '用共享日历纯函数');
  assert.match(js, /onCalPrev\(\)/, '翻月只换月份，不重新请求');
});

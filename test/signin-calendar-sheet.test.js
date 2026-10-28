/**
 * components/signin-calendar 回归：半屏月历弹窗的翻月上限、点格分流与概览分支。
 * 桩：Component() 捕获定义（与 footprint-filter-sheet.test.js 同一套路）；不依赖 wx。
 * 运行：npm test；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.Component = (def) => { global.__def = def; };
global.wx = {};
require('../miniprogram/components/signin-calendar/signin-calendar.js');
const def = global.__def;
assert.ok(def, 'signin-calendar.js 应通过 Component() 交出组件对象');

const { currentMonth, shiftMonth } = require('../miniprogram/utils/footprint-calendar.js');
const NOW_MONTH = currentMonth();
const LAST_MONTH = shiftMonth(NOW_MONTH, -1);

const day = (dateKey, state, reward = 0) => ({ dateKey, state, reward, streakDay: 1 });

function mount(props) {
  const c = Object.assign({}, def.methods);
  const merged = Object.assign({ visible: true, month: NOW_MONTH, days: [], streak: 0, percent: 0, cards: 0, loading: false, failed: false }, props);
  // 真机上 properties 会同步进 this.data，桩里得自己补这一步，否则组件读到的是空 month/days
  c.data = Object.assign(JSON.parse(JSON.stringify(def.data)), merged);
  c.events = [];
  c.setData = (patch) => Object.assign(c.data, patch);
  c.triggerEvent = (name, detail) => c.events.push({ name, detail });
  c.properties = merged;
  def.observers['visible, month, days, loading, failed'].call(
    c, merged.visible, merged.month, merged.days, merged.loading, merged.failed,
  );
  return c;
}

test('SH0 组件属性名全小写单词（微信不做 kebab→camel 转换，驼峰名收不到值）', () => {
  assert.deepEqual(
    Object.keys(def.properties).filter((k) => k !== k.toLowerCase()), [],
    'properties 里不许出现驼峰名',
  );
});

test('SH1 打开当月：出月标题与整月格子，当月不可再往前翻', () => {
  const c = mount({ month: NOW_MONTH, days: [day(`${NOW_MONTH}-02`, 'signed')] });
  assert.equal(c.data.label, `${Number(NOW_MONTH.slice(0, 4))}年${Number(NOW_MONTH.slice(5))}月`);
  assert.equal(c.data.canNext, false, '未来月份没数据，› 必须灰掉');
  assert.equal(c.data.canPrev, true);
  assert.ok(c.data.cells.filter((x) => x.date).length >= 28, '整月逐日出格');
  assert.equal(c.data.cells.find((x) => x.date === `${NOW_MONTH}-02`).mark, '✓');
});

test('SH2 翻到历史月：› 恢复可点；往前翻不越过 12 个月', () => {
  const prev = mount({ month: LAST_MONTH });
  assert.equal(prev.data.canNext, true, '历史月可以翻回当月');
  const oldest = mount({ month: shiftMonth(NOW_MONTH, -10) });
  assert.equal(oldest.data.canPrev, true, '还没到最早一格');
  const beyond = mount({ month: shiftMonth(NOW_MONTH, -11) });
  assert.equal(beyond.data.canPrev, false, '当月往前 11 格（共 12 个月可看）就是最早，‹ 灰掉');
});

test('SH3 翻月事件：‹ › 各发一次 monthchange，越界不发', () => {
  const c = mount({ month: LAST_MONTH });
  c.onPrev();
  c.onNext();
  assert.deepEqual(c.events.map((e) => e.name), ['monthchange', 'monthchange']);
  assert.equal(c.events[0].detail.month, shiftMonth(LAST_MONTH, -1));
  assert.equal(c.events[1].detail.month, NOW_MONTH);
  const atNow = mount({ month: NOW_MONTH });
  atNow.onNext();
  assert.deepEqual(atNow.events, [], '当月点 › 不该发请求');
});

test('SH4 点格分流：可补与历史漏签都交接口判，已签/未来不响应，今天等价签到按钮', () => {
  const days = [
    day(`${NOW_MONTH}-03`, 'signed'),
    day(`${NOW_MONTH}-04`, 'makeup'),
    day(`${NOW_MONTH}-05`, 'missed'),
    day(`${NOW_MONTH}-20`, 'future', 7),
    day(`${NOW_MONTH}-28`, 'today'),
  ];
  const c = mount({ days });
  const tap = (dateKey) => c.onDayTap({ currentTarget: { dataset: {
    date: dateKey, state: days.find((d) => d.dateKey === dateKey).state,
  } } });
  tap(`${NOW_MONTH}-04`);
  tap(`${NOW_MONTH}-05`);
  tap(`${NOW_MONTH}-28`);
  tap(`${NOW_MONTH}-03`);
  tap(`${NOW_MONTH}-20`);
  assert.deepEqual(c.events.map((e) => e.name), ['makeup', 'makeup', 'signin'],
    '漏签日（含历史月）一律发 makeup 给接口判；已签与未来格不发事件');
  assert.deepEqual(c.events.slice(0, 2).map((e) => e.detail.dateKey), [`${NOW_MONTH}-04`, `${NOW_MONTH}-05`]);
});

test('SH5 关闭与重试事件带当月参数', () => {
  const c = mount({ month: LAST_MONTH, failed: true });
  c.onClose();
  c.onRetry();
  assert.deepEqual(c.events.map((e) => e.name), ['close', 'retry']);
  assert.equal(c.events[1].detail.month, LAST_MONTH);
});

test('SH6 概览分支写在模板里：连签 0 天不出现「超过 0% 用户」', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/components/signin-calendar/signin-calendar.wxml'), 'utf8');
  assert.match(wxml, /wx:if="\{\{streak > 0\}\}"[^>]*>[\s\S]{0,80}超过 \{\{percent\}\}% 用户/);
  assert.match(wxml, /wx:else[\s\S]{0,60}今天签到开启连签/);
  // 组件不查库：数据与请求都归页面，这里出现 api 引用就是越界
  const js = fs.readFileSync(path.join(__dirname, '../miniprogram/components/signin-calendar/signin-calendar.js'), 'utf8');
  assert.equal(/require\('[^']*services\/api/.test(js), false, '组件不得直接引 api 服务');
});

test('SH7 弹窗内有兑换补签卡入口：点它发 exchange 事件，且入口带箭头', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/components/signin-calendar/signin-calendar.wxml'), 'utf8');
  assert.match(wxml, /catchtap="onExchange"[^>]*>[\s\S]{0,40}兑换补签卡/, '入口文字要写明是兑换补签卡');
  assert.match(wxml, /兑换补签卡[^<]*›|>[^<]*兑换补签卡 ›/, '可点的入口要带 › 箭头');
  const c = mount({ cards: 0 });
  c.onExchange();
  assert.deepEqual(c.events.map((e) => e.name), ['exchange']);
});

test('SH8 模板不留空白格：补位日期照常出圆点与日号，只换置灰类', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/components/signin-calendar/signin-calendar.wxml'), 'utf8');
  const grid = wxml.slice(wxml.indexOf('class="grid"'));
  assert.equal(grid.includes('wx:else'), false, '补位格不得再走"只画一个空格子"的分支');
  assert.match(grid, /class="dot dot-\{\{item\.state\}\}[^"]*\{\{item\.out \? 'dot-out' : ''\}\}"/,
    'out 只影响样式类，dot 节点本身要在');
  const wxss = fs.readFileSync(path.join(__dirname, '../miniprogram/components/signin-calendar/signin-calendar.wxss'), 'utf8');
  assert.match(wxss, /\.dot-out\s*\{[^}]*\}/, '置灰样式得真存在');
  assert.equal(/\.dot-out\s*\{[^}]*opacity/.test(wxss), false, '不能用整格 opacity 置灰（会把✓压到读不清）');
});

/**
 * 计划历史月历 + 单日详情（页级回归）：
 * - 月历装载：cells 数量补齐整行、pct 归一化到 0–1、达成标记、周记录文案；
 * - 单日详情装载：三项指标格式化（km/分钟/次）与轨迹摘要；
 * - 点击格子跳单日详情；「更改计划」跳计划设置页。
 * 运行：node --test test/plan-history-calendar.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

let apiCalls = [];
let respond = () => Promise.resolve({});
const fakeApi = {
  get(p) {
    apiCalls.push(p);
    return respond(p);
  },
};
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };

const navs = [];
global.wx = {
  navigateTo: (o) => navs.push(o.url),
  navigateBack: () => {},
  getSystemInfoSync: () => ({ pixelRatio: 2 }),
  stopPullDownRefresh: () => {},
  showToast: () => {},
};
let pageDef = null;
global.Page = (d) => { pageDef = d; };
global.getApp = () => ({ hasSession: () => true, globalData: {} });

require('../miniprogram/pages/plan-history/plan-history.js');
const historyDef = pageDef;
assert.ok(historyDef);

function boot(def) {
  const p = Object.assign({}, def);
  p.data = JSON.parse(JSON.stringify(def.data));
  p.setData = (patch, cb) => {
    Object.assign(p.data, patch);
    if (cb) cb();
  };
  // canvas 相关在页级测试里桩掉（node 无 canvas）
  p.draw = () => {};
  p.drawBigRing = () => {};
  return p;
}

const flush = () => new Promise((r) => setImmediate(r));

test('PHC1 月历装载：cells 补齐整行、pct 归一、达成与今天标记', async () => {
  apiCalls = [];
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const mm = String(m).padStart(2, '0');
  respond = (p) => {
    if (p.startsWith('/plan/calendar')) {
      return Promise.resolve({
        month: `${y}-${mm}`,
        days: [
          { date: `${y}-${mm}-01`, windowStart: 1, rings: [{ key: 'distance', pct: 1.4 }, { key: 'duration', pct: 0.5 }, { key: 'count', pct: 0 }], allAchieved: false, source: 'snapshot' },
        ],
        weeks: [
          { period: 'weekly', periodKey: `${y}-${mm}-03`, windowStart: Date.parse(`${y}-${mm}-03T00:00:00+08:00`), windowEnd: Date.parse(`${y}-${mm}-10T00:00:00+08:00`),
            rings: [{ key: 'distance', value: 12000, target: 21000, pct: 0.57 }], allAchieved: false },
        ],
      });
    }
    if (p === '/plan/summary') {
      return Promise.resolve({
        totalPeriods: 12, achievedPeriods: 8, rate: 0.67,
        streak: { current: 3, best: 5 },
        totals: { distanceM: 48000, durationSec: 14400, count: 12 },
        milestones: [
          { key: 'first', label: '首次达成', desc: '完成 1 次目标', unlocked: true, cur: 8, need: 1 },
          { key: 'week', label: '坚持一周', desc: '达成 7 次', unlocked: true, cur: 8, need: 7 },
          { key: 'habit', label: '习惯养成', desc: '达成 20 次', unlocked: false, cur: 8, need: 20 },
        ],
      });
    }
    if (p === '/plan/current') {
      return Promise.resolve({
        plan: { period: 'daily', targets: { distanceM: 3000, durationMin: 30, count: 1 } },
        progress: { distanceM: 1500, durationSec: 600, count: 0 },
        today: { distanceM: 1500, durationSec: 600, count: 0 },
        rings: [
          { key: 'distance', value: 1500, target: 3000, pct: 0.5 },
          { key: 'duration', value: 600, target: 1800, pct: 0.33 },
          { key: 'count', value: 0, target: 1, pct: 0 },
        ],
      });
    }
    return Promise.resolve({});
  };

  const p = boot(historyDef);
  p.data.y = y;
  p.data.m = m;
  p.data.monthText = `${y}年${m}月`;
  await p.load();
  await flush();

  assert.ok(apiCalls[0].startsWith('/plan/calendar?month='), `请求月历：${apiCalls[0]}`);
  assert.equal(p.data.cells.length % 7, 0, 'cells 补齐到整行');
  const first = p.data.cells.find((c) => c.date === `${y}-${mm}-01`);
  assert.deepEqual(first.pct, [1, 0.5, 0], 'pct 归一化并封顶 1');
  assert.equal(first.done, false);
  assert.equal(p.data.weeks.length, 1);
  assert.match(p.data.weeks[0].rangeText, /月.*日 - .*月.*日/, '周记录展示区间');
  assert.equal(p.data.weeks[0].achieved, false);
  assert.match(p.data.weeks[0].distText, /12\.0\/21\.0 km/);

  // 当前周期概况卡
  assert.ok(p.data.current, '装载当前周期概况');
  assert.equal(p.data.current.periodText, '今天');
  assert.equal(p.data.current.achieved, false);
  assert.deepEqual(p.data.current.metrics.map((m) => `${m.cur}/${m.target}${m.unit}`), [
    '1.5/3.0km', '10/30分钟', '0/1次',
  ]);
  assert.match(p.data.current.remainText, /还差/);
  assert.match(p.data.current.remainText, /1\.5 km/);

  // 记录数据概况 + 奖杯
  assert.ok(p.data.summary, '装载概况');
  assert.deepEqual(p.data.summary.cards.map((c) => `${c.num}${c.cap}`), ['12已完成周期', '8达成次数', '67%达成率', '3连续达成']);
  assert.match(p.data.summary.totalsText, /累计 48\.0 km/);
  assert.equal(p.data.summary.bestStreakText, '最佳连续 5 次');
  assert.equal(p.data.summary.trophies.length, 3);
  assert.equal(p.data.summary.trophies[0].progressText, '已解锁');
  assert.equal(p.data.summary.trophies[2].progressText, '8/20', '未解锁显示进度');
  assert.equal(p.data.hasPlan, true, '有计划 → 右上角显示「更改计划」');
});

test('PHC5 半屏打开时卸载 canvas（原生组件会盖住蒙层），关闭后重绘', async () => {
  const fs = require('fs');
  const path = require('path');
  const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/plan-history/plan-history.wxml'), 'utf8');
  assert.match(wxml, /<canvas wx:if="\{\{!sheetVisible\}\}"/, 'canvas 必须受 sheetVisible 控制');

  const p = boot(historyDef);
  let drew = 0;
  p.draw = () => { drew += 1; };
  p.openPlanSheet();
  assert.equal(p.data.sheetVisible, true);
  p.closePlanSheet();
  assert.equal(p.data.sheetVisible, false);
  assert.equal(drew, 1, '关闭后要重绘月历');
});

test('PHC4 无计划：右上角显示「创建计划」；有计划时显示「更改计划」', async () => {
  respond = (p) => {
    if (p.startsWith('/plan/calendar')) return Promise.resolve({ month: '2026-11', days: [], weeks: [] });
    if (p === '/plan/summary') return Promise.resolve(null);
    if (p === '/plan/current') return Promise.resolve({ plan: null, progress: { distanceM: 0, durationSec: 0, count: 0 }, rings: [] });
    return Promise.resolve({});
  };
  const p = boot(historyDef);
  await p.load();
  await flush();
  assert.equal(p.data.hasPlan, false, '无计划');
  assert.equal(p.data.current, null, '没有当前周期卡');

  // 有计划（同一次会话再拉一次）
  respond = (p2) => {
    if (p2.startsWith('/plan/calendar')) return Promise.resolve({ month: '2026-11', days: [], weeks: [] });
    if (p2 === '/plan/summary') return Promise.resolve(null);
    if (p2 === '/plan/current') {
      return Promise.resolve({
        plan: { period: 'daily', targets: { distanceM: 3000, durationMin: 30, count: 1 } },
        progress: { distanceM: 0, durationSec: 0, count: 0 },
        rings: [],
      });
    }
    return Promise.resolve({});
  };
  await p.load();
  await flush();
  assert.equal(p.data.hasPlan, true, '有计划');
});

test('PHC1b 当前周期已达成：remainText 提示已全部达成', async () => {
  respond = (p) => {
    if (p.startsWith('/plan/calendar')) return Promise.resolve({ month: '2026-11', days: [], weeks: [] });
    if (p === '/plan/summary') {
      return Promise.resolve({
        totalPeriods: 12, achievedPeriods: 8, rate: 0.67,
        streak: { current: 3, best: 5 },
        totals: { distanceM: 48000, durationSec: 14400, count: 12 },
        milestones: [
          { key: 'first', label: '首次达成', desc: '完成 1 次目标', unlocked: true, cur: 8, need: 1 },
          { key: 'week', label: '坚持一周', desc: '达成 7 次', unlocked: true, cur: 8, need: 7 },
          { key: 'habit', label: '习惯养成', desc: '达成 20 次', unlocked: false, cur: 8, need: 20 },
        ],
      });
    }
    if (p === '/plan/current') {
      return Promise.resolve({
        plan: { period: 'weekly', targets: { distanceM: 21000, durationMin: 210, count: 7 } },
        progress: { distanceM: 25000, durationSec: 13000, count: 8 },
        today: { distanceM: 0, durationSec: 0, count: 0 },
        rings: [
          { key: 'distance', value: 25000, target: 21000, pct: 1 },
          { key: 'duration', value: 13000, target: 12600, pct: 1 },
          { key: 'count', value: 8, target: 7, pct: 1 },
        ],
      });
    }
    return Promise.resolve({});
  };
  const p = boot(historyDef);
  await p.load();
  await flush();
  assert.equal(p.data.current.periodText, '本周');
  assert.equal(p.data.current.achieved, true);
  assert.equal(p.data.current.remainText, '本期目标已全部达成');
});

test('PHC2 点日历某天 → 就地展开当日详情（不跳页）；再点收起；更改计划仍跳设置页', async () => {
  respond = (p) => {
    if (p.startsWith('/plan/day')) {
      return Promise.resolve({
        date: '2026-11-10',
        rings: [
          { key: 'distance', value: 2400, target: 3000, pct: 0.8 },
          { key: 'duration', value: 1080, target: 1800, pct: 0.6 },
          { key: 'count', value: 1, target: 1, pct: 1 },
        ],
        allAchieved: false,
        tracks: [{ id: 't1', type: 'running', distanceM: 2400, durationSec: 1080, startTime: Date.parse('2026-11-10T09:12:00+08:00') }],
      });
    }
    return Promise.resolve({});
  };
  navs.length = 0;
  const p = boot(historyDef);
  await p.onCellTap({ currentTarget: { dataset: { date: '2026-11-10' } } });
  await flush();

  assert.deepEqual(navs, [], '不跳页');
  assert.equal(p.data.selectedDate, '2026-11-10');
  assert.equal(p.data.selected.title, '11月10日 · 周二');
  assert.deepEqual(p.data.selected.metrics.map((m) => `${m.cur}/${m.target}${m.unit}`), [
    '2.4/3.0km', '18/30分钟', '1/1次',
  ]);
  assert.equal(p.data.selected.tracks.length, 1);
  assert.equal(p.data.selected.tracks[0].timeText, '09:12');

  // 再点同一天 → 收起
  await p.onCellTap({ currentTarget: { dataset: { date: '2026-11-10' } } });
  assert.equal(p.data.selectedDate, '');
  assert.equal(p.data.selected, null);

  navs.length = 0;
  p.openPlanSheet();
  assert.equal(p.data.sheetVisible, true, '右上角改为打开半屏（不跳页）');
  assert.deepEqual(navs, [], '不产生页面跳转');
  p.onPlanSaved();
  assert.equal(p.data.sheetVisible, false, '保存后收起');
});

test('PHC3 选中日期装载：三项格式化与轨迹摘要（原单日页逻辑已并入历史页）', async () => {
  respond = (p) => {
    if (p.startsWith('/plan/day')) {
      return Promise.resolve({
        date: '2026-11-10',
        windowStart: 0,
        rings: [
          { key: 'distance', value: 2400, target: 3000, pct: 0.8 },
          { key: 'duration', value: 1080, target: 1800, pct: 0.6 },
          { key: 'count', value: 1, target: 1, pct: 1 },
        ],
        allAchieved: false,
        source: 'snapshot',
        tracks: [
          { id: 't1', type: 'running', distanceM: 2400, durationSec: 1080, startTime: Date.parse('2026-11-10T09:12:00+08:00') },
        ],
      });
    }
    return Promise.resolve({});
  };
  const p = boot(historyDef);
  await p.loadDay('2026-11-10');
  await flush();

  assert.equal(p.data.selected.title, '11月10日 · 周二');
  assert.deepEqual(p.data.selected.metrics.map((m) => `${m.cur}/${m.target}${m.unit}`), [
    '2.4/3.0km', '18/30分钟', '1/1次',
  ]);
  assert.equal(p.data.selected.metrics[0].pct, 80);
  assert.equal(p.data.selected.tracks.length, 1);
  assert.equal(p.data.selected.tracks[0].distText, '2.4 km');
  assert.equal(p.data.selected.tracks[0].durText, '18 分钟');
});

test('PHC6 绘制健壮性：canvas 节点/尺寸未就绪时重试，就绪后画出；并发只认最后一次', async () => {
  const p = boot(historyDef);
  // 还原真实 draw（boot 里被桩掉了），只替换 canvas 相关 API
  p.draw = historyDef.draw;
  p.data.cells = [{ key: 'd1', date: '2026-11-01', day: '1', out: false, pct: [1, 0.5, 0], done: false }];

  let calls = 0;
  const created = [];
  const canvasStub = {
    width: 0, height: 0,
    getContext: () => ({
      scale() {}, clearRect() {}, beginPath() {}, arc() {}, stroke() {}, fill() {},
      fillText() {}, set font(v) {}, set textAlign(v) {}, set textBaseline(v) {},
      set lineWidth(v) {}, set lineCap(v) {}, set strokeStyle(v) {}, set fillStyle(v) {},
    }),
  };
  p.createSelectorQuery = () => {
    const q = {
      select: () => q,
      boundingClientRect: () => q,
      node: () => q,
      exec: (cb) => {
        calls += 1;
        // 第一次：节点还没就绪（模拟首帧空白）；之后正常
        if (calls === 1) return cb([{ width: 342 }, { node: null }]);
        created.push(canvasStub);
        return cb([{ width: 342 }, { node: canvasStub }]);
      },
    };
    return q;
  };
  p.setData = (patch, cb) => {
    Object.assign(p.data, patch);
    if (cb) cb();
  };

  p.draw();
  assert.equal(calls, 1, '第一次拿不到节点');
  await new Promise((r) => setTimeout(r, 120));
  assert.ok(calls >= 2, '未就绪要自动重试');
  assert.equal(created.length, 1, '重试后成功绘制');
  assert.ok(canvasStub.width > 0, '画布像素尺寸已设置（不再是空白）');
});

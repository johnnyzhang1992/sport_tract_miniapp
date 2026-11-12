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
const appGlobalData = {};
global.getApp = () => ({ hasSession: () => true, globalData: appGlobalData });

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

test('PHC8 月历用纯 CSS 三环（conic-gradient + mask），不再依赖 canvas', () => {
  const fs = require('fs');
  const path = require('path');
  const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/plan-history/plan-history.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/plan-history/plan-history.wxss'), 'utf8');

  assert.equal(/<canvas/.test(wxml), false, '不再使用 canvas（真机偶发空白）');
  assert.match(wxml, /conic-gradient\(#FA114F/, '距离环用 conic-gradient 画扇形');
  assert.match(wxml, /conic-gradient\(#92E82A/, '时间环');
  assert.match(wxml, /conic-gradient\(#1AD4E0/, '次数环');
  assert.match(wxss, /-webkit-mask: radial-gradient/, '用 mask 挖空成环');
  assert.match(wxml, /bindtap="onCellTap"/, '整格可点（不再需要透明点击层）');
});

test('PHC9 保存计划后打 homeDirty：返回首页无视 60s 节流立刻重拉计划卡', () => {
  appGlobalData.homeDirty = undefined;
  const p = boot(historyDef);
  p.onPlanSaved();
  assert.equal(appGlobalData.homeDirty, true, '保存计划要给首页打脏标记（首页 onShow 见标记即越 TTL 重拉）');
});

test('PHC10 当期达成：当天首次进页弹一次；同周期再进不弹；周计划文案不同；未达成不弹', () => {
  const store = new Map();
  const modals = [];
  wx.getStorageSync = (k) => (store.has(k) ? store.get(k) : '');
  wx.setStorageSync = (k, v) => store.set(k, v);
  wx.showModal = (o) => modals.push(o);

  const p = boot(historyDef);
  const plan = { period: 'daily', targets: { distanceM: 5000, durationMin: 30, count: 1 } };
  const sum = { milestones: [], overStreak: 0 };

  p.maybePrompt({ plan, allAchieved: true, periodKey: '2026-11-12' }, sum);
  assert.equal(modals.length, 1, '当天达成首次进页要弹');
  assert.equal(modals[0].title, '今日目标达成');
  assert.equal(modals[0].content, '三项计划全部完成，干得漂亮！');
  assert.equal(modals[0].confirmText, '太棒了');

  p.maybePrompt({ plan, allAchieved: true, periodKey: '2026-11-12' }, sum);
  assert.equal(modals.length, 1, '同一周期再进不弹');

  p.maybePrompt({ plan: Object.assign({}, plan, { period: 'weekly' }), allAchieved: true, periodKey: '2026-11-10' }, sum);
  assert.equal(modals.length, 2, '新周期达成要弹');
  assert.equal(modals[1].title, '本周目标达成');

  p.maybePrompt({ plan, allAchieved: false, periodKey: '2026-11-13' }, sum);
  assert.equal(modals.length, 2, '未达成不弹');
});

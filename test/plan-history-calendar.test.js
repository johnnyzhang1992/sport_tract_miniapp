/**
 * 计划历史月历 + 单日详情（页级回归）：
 * - 月历装载：cells 数量补齐整行、pct 归一化到 0–1、达成标记、周记录文案；
 * - 单日详情装载：三项指标格式化（km/分钟/次）与轨迹摘要；
 * - 点击格子跳单日详情；「更改计划」跳计划设置页。
 * 运行：node --test test/plan-history-calendar.test.js
 */
const { after, test } = require('node:test');
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
// 默认视为已登录（游客态另有专门用例）；计划页 load() 会读 loggedIn
const appGlobalData = { loggedIn: true };
// 计划页 load() 先查会话（游客态展示登录引导），故桩要带 login 与 loggedIn
global.getApp = () => ({ hasSession: () => true, globalData: appGlobalData, login: () => Promise.resolve() });

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
        // 2026-11-16 配置化：展示元数据（shortLabel/shape/groupTitle/badgeText/detailText）
        // 由后端下发，前端不再维护映射表——这里按真实 API 契约造数据
        trophies: [
          { key: 'first', label: '首次达成', shortLabel: '首次达成', shape: 'plan', groupTitle: '里程碑', badgeText: '1', detailText: '已达成 8 次 · 目标 1 次', detailLines: [], desc: '完成 1 次目标', icon: '🥇', unlocked: true, cur: 8, tier: 1, group: 'plan', earnedCount: 1, earnDateText: '2026-10-20', pct: 100 },
          { key: 'week', label: '坚持一周', shortLabel: '坚持一周', shape: 'plan', groupTitle: '里程碑', badgeText: '7', detailText: '已达成 8 次 · 目标 7 次', detailLines: [], desc: '达成 7 次', icon: '📅', unlocked: true, cur: 8, tier: 7, group: 'plan', earnedCount: 1, earnDateText: '2026-10-26', pct: 100 },
          { key: 'habit', label: '习惯养成', shortLabel: '习惯养成', shape: 'plan', groupTitle: '里程碑', badgeText: '20', detailText: '已达成 8 次 · 目标 20 次', detailLines: [], desc: '达成 20 次', icon: '💪', unlocked: false, cur: 8, tier: 20, group: 'plan', earnedCount: 0, earnDateText: '', pct: 40 },
          { key: 'streak-100', label: '坚持运动·100天', shortLabel: '最坚持', shape: 'streak', groupTitle: '最坚持', badgeText: '100', detailText: '还差 98 天连续运动', detailLines: [], desc: '连续运动 100 天', icon: '🔥', unlocked: false, cur: 2, tier: 100, group: 'streak', valueText: '2 天', dateText: '', earnedCount: 0, earnDateText: '', pct: 2 },
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
  // 四列（2026-11-14）：去掉「已完成周期」，补「最佳连续」
  assert.deepEqual(
    p.data.summary.cards.map((c) => `${c.num}${c.cap}`),
    ['8达成次数', '67%达成率', '3连续达成', '5最佳连续'],
  );
  assert.match(p.data.summary.totalsText, /累计 48\.0 km/);
  assert.equal(p.data.summary.bestStreakText, undefined, '标题右侧的最佳连续已并入第四列');
  assert.equal(p.data.summary.trophies.length, 4, '奖杯扁平表 = 后端 trophies 全量');
  // 卡面第三行三态：未获得=进度条；获得一次=获取日期；获得多次=次数
  assert.equal(p.data.summary.trophies[0].earnedCount, 1, '首次达成已获得');
  assert.match(p.data.summary.trophies[0].earnDateText, /2026-/, '获得一次 → 展示获取日期');
  assert.equal(p.data.summary.trophies[2].earnedCount, 0, '习惯养成未获得');
  assert.equal(p.data.summary.trophies[2].pct, Math.round((8 / 20) * 100), '未获得 → 进度条百分比 cur/tier');
  assert.equal(p.data.summary.trophies[3].unlocked, false, '未解锁标记');
  // 分组由 badge-wall 组件负责（页面只下发扁平表 + 分组元数据）
  assert.equal(p.data.summary.badgeGroups.length, 2, '分组元数据：里程碑 + 最坚持');
  assert.deepEqual(p.data.summary.badgeGroups.map((g) => g.title), ['里程碑', '最坚持']);
  // 徽章中央文字由服务端 badgeText 决定（曾叫 text 导致整墙不显示数字）
  assert.equal(p.data.summary.trophies[3].badgeText, '100', '记录型徽章中央印档位数');
  assert.equal(p.data.summary.trophies[0].badgeText, '1', '里程碑徽章中央印需要次数');
  assert.ok(p.data.summary.trophies[0].cls, '每座徽章带好形状样式类（前端派生）');
  // 2026-11-16 起徽章墙抽成 badge-wall 组件，计划页只负责传数据：
  //   - 徽章区按 plan 分类计数决定是否渲染（运动数据类已搬到「我的徽章」页）
  //   - 组件拿 summary.trophies + summary.badgeGroups，category="plan"
  const trophyWxml = require('fs').readFileSync(
    require('path').join(__dirname, '../miniprogram/pages/plan-history/plan-history.wxml'), 'utf8',
  );
  assert.ok(trophyWxml.includes('summary.planTotal > 0'), '徽章区按计划类总数决定是否渲染');
  assert.ok(trophyWxml.includes('<badge-wall'), '徽章墙改用 badge-wall 组件');
  assert.ok(trophyWxml.includes('trophies="{{summary.trophies}}"'), '组件接收 summary.trophies');
  assert.ok(trophyWxml.includes('groups="{{summary.badgeGroups}}"'), '组件接收 summary.badgeGroups');
  assert.ok(trophyWxml.includes('category="plan"'), '计划页只显示计划类徽章');
  assert.ok(trophyWxml.includes('bindtap="goAllBadges"'), '带「查看全部徽章」入口');
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
      const today0 = (() => {
        const d = new Date(Date.now() + 8 * 3600_000);
        return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 8 * 3600_000;
      })();
      return Promise.resolve({
        plan: { period: 'weekly', targets: { distanceM: 21000, durationMin: 210, count: 7 } },
        // 固定 7 天一期：今天 00:00（东八区）起，到 +7 天
        windowStart: today0,
        windowEnd: today0 + 7 * 86_400_000,
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
  assert.equal(p.data.current.periodText, '今天', '周计划下线后当期标题恒为「今天」');
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

test('PHC9 未覆盖计划期的日期：徽标「无计划」、不展示三项完成度（不拿当前目标回溯）', async () => {
  respond = (p) => {
    if (p.startsWith('/plan/day')) {
      return Promise.resolve({
        date: '2026-10-07',
        windowStart: 0,
        rings: [
          { key: 'distance', value: 2900, target: 0, pct: 0 },
          { key: 'duration', value: 1380, target: 0, pct: 0 },
          { key: 'count', value: 0, target: 0, pct: 0 },
        ],
        allAchieved: false,
        noPlan: true,
        source: 'none',
        tracks: [
          { id: 't1', type: 'running', distanceM: 2900, durationSec: 1380, startTime: Date.parse('2026-10-07T09:00:00+08:00') },
        ],
      });
    }
    return Promise.resolve({});
  };
  const p = boot(historyDef);
  await p.loadDay('2026-10-07');
  await flush();

  assert.equal(p.data.selected.noPlan, true, '端上要知道这天没有计划');
  assert.equal(p.data.selected.achieved, false, '不算达成');
  assert.equal(p.data.selected.tracks.length, 1, '当天运动记录照常展示');
  const wxml = require('fs').readFileSync(
    require('path').join(__dirname, '../miniprogram/pages/plan-history/plan-history.wxml'), 'utf8',
  );
  assert.ok(wxml.includes('selected.noPlan'), '模板对 noPlan 有单独分支');
  assert.ok(wxml.includes('badge-none'), '徽标样式为「无计划」态');
  assert.ok(/wx:if="\{\{selected.noPlan\}\}"/.test(wxml), '无计划时给出说明文案');
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

  // 周计划已下线：任意新周期（不同 periodKey）当天达成只弹一次「今日目标达成」
  p.maybePrompt({ plan, allAchieved: true, periodKey: '2026-11-11' }, sum);
  assert.equal(modals.length, 2, '新周期达成要弹');
  assert.equal(modals[1].title, '今日目标达成');

  p.maybePrompt({ plan, allAchieved: false, periodKey: '2026-11-13' }, sum);
  assert.equal(modals.length, 2, '未达成不弹');
});


/* 分享（2026-11-17）：计划页要支持「发送给 / 分享到朋友圈」，
   标题只用正向指标（连续达成 / 计划徽章进度），**不展示达成率**（0% 像失败总结）。 */
test('PHC11 支持分享，且标题不含达成率', async () => {
  assert.equal(typeof historyDef.onShareAppMessage, 'function', '缺 onShareAppMessage');
  assert.equal(typeof historyDef.onShareTimeline, 'function', '缺 onShareTimeline');

  const p = boot(historyDef);
  // 造一个「达成率 0%、连续 0、无徽章」的最差情况
  p.data.summary = { cards: [{ key: 'rate', num: '0%' }, { key: 'streak', num: '0' }], planEarned: 0 };
  p.data.hasPlan = true;
  const r = historyDef.onShareAppMessage.call(p);
  assert.ok(!r.title.includes('达成率'), `标题不该出现达成率：${r.title}`);
  assert.ok(!r.title.includes('0%'), `标题不该出现 0%：${r.title}`);
  assert.equal(r.path, '/pages/plan-history/plan-history');
});

test('PHC12 有连续达成时标题体现连续天数；达成率再高也不出现', () => {
  const p = boot(historyDef);
  p.data.summary = { cards: [{ key: 'rate', num: '80%' }, { key: 'streak', num: '12' }], planEarned: 3 };
  p.data.hasPlan = true;
  const r = historyDef.onShareTimeline.call(p);
  assert.ok(r.title.includes('已连续 12 天达成'), `应体现连续天数：${r.title}`);
  assert.ok(r.title.includes('已点亮 3 座计划徽章'), `应体现徽章进度：${r.title}`);
  assert.ok(!r.title.includes('达成率'), `达成率一律不展示：${r.title}`);
});

test('PHC13 无计划时分享标题退化为通用文案，不炸', () => {
  const p = boot(historyDef);
  p.data.summary = null;
  p.data.hasPlan = false;
  assert.equal(historyDef.onShareAppMessage.call(p).title, '小迹一下 · 运动计划');
  assert.equal(historyDef.onShareTimeline.call(p).title, '小迹一下 · 运动计划');
});

/* 游客态（2026-11-17）：/plan/* 需要登录，未登录不能显示「加载失败」 */
test('PHC14 游客访问：不请求接口、不显示加载失败，展示登录引导', async () => {
  const p = boot(historyDef);
  let called = 0;
  const origGet = fakeApi.get;
  const origLogin = appGlobalData.loggedIn;
  appGlobalData.loggedIn = false;
  fakeApi.get = () => { called += 1; return Promise.resolve({}); };
  try {
    await historyDef.load.call(p);
    assert.equal(called, 0, '游客态不该请求 /plan/*');
    assert.equal(p.data.notLoggedIn, true, '应标记游客态');
    assert.equal(p.data.failed, false, '不该显示「加载失败」');
  } finally {
    fakeApi.get = origGet;
    appGlobalData.loggedIn = origLogin;
  }
});

/* 游客态不能打开计划编辑面板（2026-11-17）：
   WXML 里入口已隐藏，这里守 JS 兜底——即使从别的路径调用也不能弹出「保存必失败」的面板。 */
test('PHC15 游客调用 openPlanSheet：转为拉登录，不打开半屏', () => {
  const p = boot(historyDef);
  p.data.notLoggedIn = true;
  let loginCalled = 0;
  p.goLogin = () => { loginCalled += 1; };
  historyDef.openPlanSheet.call(p);
  assert.equal(p.data.sheetVisible, false, '游客态不该打开计划半屏');
  assert.equal(loginCalled, 1, '应转为拉登录');
});

test('PHC16 已登录调用 openPlanSheet：正常打开半屏', () => {
  const p = boot(historyDef);
  p.data.notLoggedIn = false;
  historyDef.openPlanSheet.call(p);
  assert.equal(p.data.sheetVisible, true);
});

/* 模板广告（2026-11-17）：计划页在「记录数据概况」上方挂一个广告位。
   unit-id 由后台 adSlots 下发，端上只写 key；展示与否由 ad-template 组件判定
   （未免广告期 / 后台在架 / 有库存），页面不自己判断。 */
test('PHC17 计划页挂了 ad-template，位置在「记录数据概况」卡片之前', () => {
  const fsx = require('node:fs');
  const pathx = require('node:path');
  const rd = (p) => fsx.readFileSync(pathx.join(__dirname, '..', p), 'utf8');
  const wxml = rd('miniprogram/pages/plan-history/plan-history.wxml');
  assert.ok(wxml.includes('<ad-template'), '应有 ad-template');
  assert.ok(wxml.includes('adslot="plan_history"'), '广告位 key 应为 plan_history');
  const adIdx = wxml.indexOf('<ad-template');
  // 按卡片 class 定位（不能搜「记录数据概况」字样——广告上方的注释里也写了这个词）
  const sumIdx = wxml.indexOf('class="card sum-card"');
  assert.ok(adIdx > 0 && sumIdx > adIdx, '广告应在「记录数据概况」卡片上方');

  const json = JSON.parse(rd('miniprogram/pages/plan-history/plan-history.json'));
  assert.ok(
    (json.usingComponents || {})['ad-template'],
    '页面 json 必须注册 ad-template（否则不渲染）',
  );
});

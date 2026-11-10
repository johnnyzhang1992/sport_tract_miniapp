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
});

test('PHC1b 当前周期已达成：remainText 提示已全部达成', async () => {
  respond = (p) => {
    if (p.startsWith('/plan/calendar')) return Promise.resolve({ month: '2026-11', days: [], weeks: [] });
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

  p.goPlan();
  assert.deepEqual(navs, ['/pages/plan/plan'], '历史页保留更改计划入口');
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

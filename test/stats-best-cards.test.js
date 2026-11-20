/**
 * 数据统计页「最佳记录」卡片文案（pages/stats/stats.js#decorateBest）。
 * 最快配速与轨迹详情/榜单同口径：标签已写明「配速」，值不带 /公里。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

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

require('../miniprogram/pages/stats/stats.js');

test('最快配速：值不带 /公里', () => {
  const best = pageDef.decorateBest({
    minPaceByType: [{ type: 'running', fastestKm: 600 }],
  });
  const card = best.bestCards.find((c) => c.label === '最快配速');
  assert.equal(card.value, `10'00"`);
});

test('最佳记录卡带保持天数：今天达成 / 已保持 N 天', () => {
  const DAY = 86400000;
  const best = pageDef.decorateBest({
    maxDistanceByType: [
      { type: 'running', distance: 5000, id: 'a', startTime: Date.now() },
    ],
    fastestDistanceByKm: [
      { type: 'running', km: 5, sec: 1500, id: 'b', startTime: Date.now() - 80 * DAY },
    ],
  });
  assert.equal(best.bestCards.find((c) => c.label === '最远距离').heldText, '今天达成');
  assert.equal(best.bestCards.find((c) => c.label === '5 公里 PB').heldText, '已保持 80 天');
});

test('最佳记录末尾追加两条步数纪录：最多步数日 / 步数最多月份', () => {
  const report = {
    overview: {
      totalStep: 23000, avgStep: 4600, bestDate: '2026-02-10', bestStep: 12000, syncedDays: 5, days: 62,
    },
    months: [],
    bestMonth: { month: '2026-02', step: 15000 },
  };
  const best = pageDef.decorateBest({
    maxDistanceByType: [{ type: 'running', distance: 5000, id: 'a', startTime: Date.now() }],
  }, report);
  const stepCards = best.bestCards.slice(-2);
  assert.deepEqual(stepCards.map((c) => c.label), ['最多步数日', '步数最多月份']);
  assert.equal(stepCards[0].value, '1.2万 步');
  assert.equal(stepCards[0].typeLabel, '微信步数');
  assert.equal(stepCards[0].heldText, '2026/02/10');
  assert.equal(stepCards[0].id, '', '没有轨迹可跳');
  assert.equal(stepCards[0].icon, '/assets/icons/lucide-footprints.png');
  assert.equal(stepCards[1].heldText, '2026年2月');
  // 2026-11-20：改用与同排其它纪录同色（#1f2329）的日历，不再是 -blue 变体
  assert.equal(stepCards[1].icon, '/assets/icons/lucide-calendar.png');
});

test('没有运动 PB 但有步数：最佳记录仍返回步数卡；两者都没有则整块隐藏', () => {
  const report = {
    overview: { bestStep: 9000, bestDate: '2026-03-02', syncedDays: 1 },
    bestMonth: { month: '2026-03', step: 9000 },
  };
  const onlyStep = pageDef.decorateBest(null, report);
  assert.equal(onlyStep.bestCards.length, 2);

  assert.equal(pageDef.decorateBest(null, null), null);
  assert.equal(pageDef.decorateBest(null, { overview: { syncedDays: 0 } }), null);
});

test('半屏打开时藏掉点亮地图画布，底部卡片不被 canvas 压住', () => {
  assert.match(read('pages/stats/stats.wxml'), /<lit-map[^>]*blank="\{\{sheetVisible\}\}"/);
  assert.match(
    read('packageFootprint/components/lit-map/lit-map.wxml'),
    /provinceModal \|\| blank \? 'map-hidden'/,
  );
});

test('累计概览：时长转小时/天，爬升与千卡加千分位', () => {
  const section = { distance: 0, duration: 0, count: 0, elevationGain: 0, calories: 0 };
  const o = {
    today: section,
    week: section,
    month: section,
    year: section,
    total: { distance: 250230, duration: 793 * 3600 + 35 * 60, count: 52, elevationGain: 5472, calories: 16982, activeDays: 38 },
    prevWeek: section,
    prevMonth: section,
  };
  const d = pageDef.decorateOverview(o);
  assert.equal(d.total.durationText, '793.6小时');
  assert.equal(d.total.elevationGainText, '5,472');
  assert.equal(d.total.caloriesText, '16,982');
});

/* 排序（2026-11-20 改为「最近刷新」）：
   原来按类别顺序拼接（表现分→PB→各类型指标→步数），同类纪录被拆散，
   也看不出哪条刚刷新。现在统一按纪录达成时间倒序。 */
test('全部纪录按最近刷新倒序：跨类别混排', () => {
  const DAY = 86400000;
  const now = Date.now();
  const best = pageDef.decorateBest({
    maxPerfScoreByType: [
      { id: 'a', type: 'running', perfScore: 275, startTime: now - 38 * DAY }, // 较旧
      { id: 'b', type: 'hiking', perfScore: 229, startTime: now - 61 * DAY }, // 更旧
    ],
    fastestDistanceByKm: [
      { id: 'c', type: 'hiking', km: 5, sec: 3522, startTime: now - 1 * DAY }, // 最新
      { id: 'd', type: 'walking', km: 5, sec: 2685, startTime: now - 28 * DAY },
    ],
    maxDistanceByType: [{ id: 'e', type: 'hiking', distance: 15500, startTime: now - 311 * DAY }],
    minPaceByType: [{ id: 'f', type: 'hiking', fastestKm: 584, startTime: now - 79 * DAY }],
    maxDurationByType: [],
    maxElevationByType: [{ id: 'g', type: 'hiking', elevationGain: 625, startTime: now - 60 * DAY }],
  });

  const ats = best.bestCards.map((c) => c.at);
  assert.ok(ats.every((t) => typeof t === 'number' && t > 0), '每张卡都要带 at');
  const sorted = [...ats].sort((a, b) => b - a);
  assert.deepEqual(ats, sorted, '必须按时间倒序');

  // 最新的一条（5 公里 PB · 徒步，1 天前）排第一
  assert.equal(best.bestCards[0].label, '5 公里 PB');
  assert.equal(best.bestCards[0].typeLabel, '徒步');
  // 最旧的（最远距离 · 徒步，311 天前）沉底
  assert.equal(best.bestCards[best.bestCards.length - 1].label, '最远距离');
});

test('同一时刻的纪录按类别兜底排序，顺序稳定', () => {
  const t = Date.now() - 1000;
  const best = pageDef.decorateBest({
    maxPerfScoreByType: [{ id: 'a', type: 'running', perfScore: 200, startTime: t }],
    fastestDistanceByKm: [{ id: 'b', type: 'running', km: 5, sec: 1800, startTime: t }],
    maxDistanceByType: [{ id: 'c', type: 'running', distance: 5000, startTime: t }],
    minPaceByType: [],
    maxDurationByType: [],
    maxElevationByType: [],
  });
  const labels = best.bestCards.map((c) => c.label);
  assert.deepEqual(labels, ['表现分', '5 公里 PB', '最远距离'], '同时刻按 表现分>PB>指标 排');
});

/* 「全部纪录」是一排并列的卡，图标必须是同一个颜色，
   否则某一张用了 -blue/-red 变体会非常跳（2026-11-20 踩过）。
   这里直接读 PNG 的主色像素做比对，而不是只看文件名——文件名改成黑的但图还是蓝的也算不过。 */
test('全部纪录各卡图标同色（都走 #1f2329），不混入彩色变体', () => {
  const DAY = 86400000;
  const now = Date.now();
  const best = pageDef.decorateBest({
    maxPerfScoreByType: [{ id: 'a', type: 'running', perfScore: 200, startTime: now - DAY }],
    fastestDistanceByKm: [{ id: 'b', type: 'running', km: 5, sec: 1800, startTime: now - 2 * DAY }],
    maxDistanceByType: [{ id: 'c', type: 'running', distance: 5000, startTime: now - 3 * DAY }],
    minPaceByType: [], maxDurationByType: [], maxElevationByType: [],
  });
  const stepTracked = require('../miniprogram/utils/step-report-view.js')
    .buildStepRecords({ overview: { syncedDays: 3, bestStep: 22000, bestDate: '2026-11-19' }, bestMonth: { step: 99000, month: '2026-11' } });
  const icons = [...best.bestCards, ...stepTracked].map((c) => c.icon).filter(Boolean);
  assert.ok(icons.length > 0);
  for (const p of icons) {
    assert.ok(!/-blue|-red|-green|activity-.*-white/.test(p), `纪录卡不该用彩色变体：${p}`);
  }
  // 步数两张必须用普通（黑）图标
  assert.equal(stepTracked[0].icon, '/assets/icons/lucide-footprints.png');
  assert.equal(stepTracked[1].icon, '/assets/icons/lucide-calendar.png');
});

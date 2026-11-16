/**
 * 徽章卡片最上方的「已获得」区（2026-11-16）：
 * - earnedCount = 已解锁**座数**（不是获得次数：同一座拿多次仍算 1 座）
 * - earnedList 按获取日期倒序（最新在前），同日保持服务端原顺序
 * - 全部未解锁 → 空列表 + earnedCount 0（页面渲染空态说明）
 * 运行：node --test test/plan-history-earned.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

let respond = () => Promise.resolve({});
const fakeApi = { get: () => respond(), post: () => respond(), put: () => respond() };
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };

global.wx = {
  navigateTo: () => {},
  navigateBack: () => {},
  getSystemInfoSync: () => ({ pixelRatio: 2 }),
  stopPullDownRefresh: () => {},
  showToast: () => {},
};
let pageDef = null;
global.Page = (d) => { pageDef = d; };
global.getApp = () => ({ hasSession: () => true, globalData: {} });

require('../miniprogram/pages/plan-history/plan-history.js');
const def = pageDef;
assert.ok(def);

/* 徽章墙组件（2026-11-16 重构后，分组/短名/形状翻译的唯一渲染实现）。
   PE9- 这些「配置化」用例必须测组件，而不是页面里的 trophyGroups（那段已随重构删除）。 */
let wallDef = null;
global.Component = (d) => { wallDef = d; };
require('../miniprogram/components/badge-wall/badge-wall.js');
global.Component = undefined;
assert.ok(wallDef, '徽章墙组件应已加载');

/** 用组件跑一遍 build()，返回组件 view（分组后的渲染数据） */
function wallView(trophies, groups = []) {
  const c = {
    data: { trophies, groups, category: 'all', showEarned: true, earnedTitle: '已获得', emptyText: '' },
    setData(patch) { Object.assign(this.data, patch); },
  };
  for (const [k, fn] of Object.entries(wallDef.methods)) c[k] = fn.bind(c);
  c.build();
  return c.data.view;
}

function boot() {
  const p = Object.assign({}, def);
  p.data = JSON.parse(JSON.stringify(def.data));
  p.setData = (patch, cb) => {
    Object.assign(p.data, patch);
    if (cb) cb();
  };
  return p;
}

/** 造一座徽章（字段与后端 /plan/summary 的 trophies 一致） */
function badge(key, group, unlocked, opts = {}) {
  return {
    key,
    label: opts.label || key,
    desc: 'desc',
    icon: '🏆',
    unlocked,
    cur: opts.cur ?? 1,
    tier: opts.tier ?? 1,
    nextTier: null,
    earnedCount: unlocked ? (opts.earnedCount ?? 1) : 0,
    earnDateText: unlocked ? (opts.earnDateText || '2026-01-01') : '',
    rank: unlocked ? (opts.rank ?? 1) : 0,
    rankTotal: unlocked ? (opts.rankTotal ?? 1) : 0,
    pct: unlocked ? 100 : 0,
    group,
  };
}

function summaryOf(trophies) {
  const p = boot();
  return p.buildSummary({ trophies, achievedPeriods: 0, rate: 0, streak: {}, totals: {}, records: null });
}

test('PE1 座数口径：已解锁 3 座 → earnedCount=3，totalCount=全部', () => {
  const s = summaryOf([
    badge('total-dist-100', 'total-distance', true),
    badge('total-dur-10', 'total-duration', true),
    badge('total-dur-50', 'total-duration', true),
    badge('ring-100', 'rings', false),
    badge('streak-100', 'streak', false),
  ]);
  assert.equal(s.earnedCount, 3);
  assert.equal(s.totalCount, 5);
  assert.equal(s.earnedList.length, 3);
});

test('PE2 同一座拿多次只算 1 座（earnedCount 是次数，不影响座数）', () => {
  const s = summaryOf([
    badge('perfect-week-all', 'week', true, { earnedCount: 7 }),
    badge('ring-100', 'rings', false),
  ]);
  assert.equal(s.earnedCount, 1, '同一座完美周拿了 7 次，仍只算 1 座');
  assert.equal(s.earnedList[0].key, 'perfect-week-all');
});

test('PE3 排序：按获取日期倒序，最新的在最前', () => {
  const s = summaryOf([
    badge('a', 'total-distance', true, { earnDateText: '2026-08-28' }),
    badge('b', 'total-distance', true, { earnDateText: '2026-10-30' }),
    badge('c', 'total-distance', true, { earnDateText: '2026-09-15' }),
  ]);
  assert.deepEqual(s.earnedList.map((t) => t.key), ['b', 'c', 'a']);
});

test('PE4 同日获取：保持服务端原顺序（稳定排序）', () => {
  const s = summaryOf([
    badge('first', 'plan', true, { earnDateText: '2026-07-18' }),
    badge('week', 'plan', true, { earnDateText: '2026-07-18' }),
    badge('habit', 'plan', true, { earnDateText: '2026-07-18' }),
  ]);
  assert.deepEqual(s.earnedList.map((t) => t.key), ['first', 'week', 'habit']);
});

test('PE5 列表项带够渲染字段：shortLabel / cls / badgeText 均在', () => {
  const s = summaryOf([badge('total-dur-10', 'total-duration', true)]);
  const it = s.earnedList[0];
  assert.ok(it.shortLabel, '需要 shortLabel 作卡面名称');
  assert.ok(it.cls, '需要形状 class');
  assert.ok(it.badgeText, '需要中央档位数字');
  assert.ok(it.earnDateText, '需要获取日期');
  assert.equal(it.rank, 1, '名次字段照常带出');
});

test('PE6 全部未解锁：earnedCount=0、earnedList 为空（页面走空态）', () => {
  const s = summaryOf([
    badge('ring-100', 'rings', false),
    badge('streak-100', 'streak', false),
  ]);
  assert.equal(s.earnedCount, 0);
  assert.deepEqual(s.earnedList, []);
  assert.equal(s.totalCount, 2);
});

test('PE7 空 trophies 不炸', () => {
  const s = summaryOf([]);
  assert.equal(s.earnedCount, 0);
  assert.equal(s.totalCount, 0);
  assert.deepEqual(s.earnedList, []);
});

test('PE8 已获得项仍能点进详情半屏（onTrophyTap 按 key 命中）', () => {
  const p = boot();
  p.data.summary = summaryOf([badge('total-dist-100', 'total-distance', true)]);
  p._lastSummary = { records: null };
  p.onTrophyTap({ currentTarget: { dataset: { key: 'total-dist-100' } } });
  assert.equal(p.data.trophyDetail.key, 'total-dist-100');
  assert.equal(p.data.trophyDetail.unlocked, true);
});
/* ── 配置化（2026-11-16）：徽章展示完全由服务端字段驱动 ──────────────
   这些测试守的是「后端加徽章，小程序不用改」：新 key / 新形状 / 新分组
   即使前端从没见过，也必须能正常渲染，而不是白框或空名。 */

/** 造一座「前端从没见过」的徽章：新 key、新系列名、新形状 */
function unknownBadge(overrides = {}) {
  return {
    key: 'brand-new-series-42',
    label: '全新系列·42',
    shortLabel: '全新系列',
    shape: 'brand-new-shape',
    groupTitle: '全新分区',
    badgeText: '42',
    desc: '后端新加的徽章',
    detailText: '已达成 42 次 · 目标 42 次',
    detailLines: ['第一行明细', '第二行明细'],
    icon: '🎯',
    unlocked: true,
    cur: 42,
    tier: 42,
    nextTier: null,
    earnedCount: 1,
    earnDateText: '2026-11-16',
    rank: 3,
    rankTotal: 10,
    pct: 100,
    group: 'brand-new-group',
    ...overrides,
  };
}

test('PE9 后端新加徽章：卡面名称/形状/分区全部来自服务端字段', () => {
  const v = wallView([unknownBadge()]);
  const item = v.groups[0].items[0];
  assert.equal(item.label, '全新系列', '短名用 shortLabel');
  assert.equal(v.groups[0].title, '全新分区', '分区标题用 groupTitle');
  assert.ok(item.cls, '未知形状也要有 class（退回 plan 圆牌）');
  assert.equal(item.badgeText, '42', '中央文字用 badgeText');
});

test('PE10 未知形状兜底成圆牌，不是空白/白框', () => {
  const v = wallView([unknownBadge({ shape: 'never-existed' })]);
  assert.equal(v.groups[0].items[0].cls, 'b-plan', '未知形状退回 b-plan');
});

test('PE11 已知形状仍按映射取样式（不能因为兜底把老形状弄丢）', () => {
  const shapes = {
    dist: 'b-shield b-dist',
    'total-dist': 'b-total-dist',
    'week-all': 'b-hex b-week-all',
    plan: 'b-plan',
  };
  for (const [shape, expected] of Object.entries(shapes)) {
    const v = wallView([unknownBadge({ shape, key: `k-${shape}` })]);
    assert.equal(v.groups[0].items[0].cls, expected, `形状 ${shape} 样式错`);
  }
});

test('PE12 分区顺序按服务端下发顺序（前端不再维护组序）', () => {
  const trophies = [
    unknownBadge({ key: 'a', group: 'zzz', groupTitle: '最后的分区' }),
    unknownBadge({ key: 'b', group: 'aaa', groupTitle: '最前的分区' }),
  ];
  // 服务端按 BADGE_GROUPS 排好顺序下发（这里故意给「最前分区」在前）
  const groups = [
    { key: 'aaa', title: '最前的分区', category: 'data' },
    { key: 'zzz', title: '最后的分区', category: 'data' },
  ];
  const v = wallView(trophies, groups);
  assert.deepEqual(v.groups.map((g) => g.title), ['最前的分区', '最后的分区']);
});

test('PE13 详情半屏文案全部来自服务端（前端不再按 key 拼句子）', () => {
  const p = boot();
  p.data.summary = summaryOf([unknownBadge()]);
  p.onTrophyTap({ currentTarget: { dataset: { key: 'brand-new-series-42' } } });
  assert.deepEqual(p.data.trophyDetail.detailLines, ['已达成 42 次 · 目标 42 次', '第一行明细', '第二行明细']);
  assert.equal(p.data.trophyDetail.rank, 3, '名次照常带出');
});

test('PE14 缺 groupTitle 时退回「徽章」而不是空白', () => {
  const v = wallView([unknownBadge({ groupTitle: '' })]);
  assert.equal(v.groups[0].title, '徽章');
});

test('PE15 缺 shortLabel 时退回 label，两者都缺时退回 key', () => {
  const a = wallView([unknownBadge({ shortLabel: '' })]);
  assert.equal(a.groups[0].items[0].label, '全新系列·42');
  const b = wallView([unknownBadge({ shortLabel: '', label: '' })]);
  assert.equal(b.groups[0].items[0].label, 'brand-new-series-42');
});

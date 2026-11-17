/**
 * 「我的徽章」页 + 徽章墙组件（2026-11-16）：
 * - 组件：按 category 过滤、按服务端 groups 顺序分组、未知形状兜底、已获得倒序
 * - 页面：分类切换、详情半屏文案来自服务端、空态/失败态、只展示徽章不展示类型统计
 * 运行：node --test test/badges-page.test.js
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/* ── 组件 ───────────────────────────────────────────── */
let compDef = null;
global.Component = (d) => { compDef = d; };
require('../miniprogram/components/badge-wall/badge-wall.js');

/** 实例化组件（模拟小程序 setData + properties 合并到 data） */
function bootComponent(props = {}) {
  // 小程序里 properties 的默认值会以「值」的形式落到 data（不是 {type,value} 对象）
  const propDefaults = {};
  for (const [k, v] of Object.entries(compDef.properties)) {
    propDefaults[k] = v && typeof v === 'object' && 'value' in v ? v.value : v;
  }
  const inst = {
    data: {
      ...JSON.parse(JSON.stringify(propDefaults)),
      ...JSON.parse(JSON.stringify(compDef.data)),
      ...props,
    },
    events: [],
    setData(patch, cb) {
      Object.assign(this.data, patch);
      if (cb) cb();
    },
    triggerEvent(name, detail) {
      this.events.push({ name, detail });
    },
  };
  for (const [k, fn] of Object.entries(compDef.methods)) inst[k] = fn.bind(inst);
  inst.build();
  return inst;
}

function badge(key, group, category, opts = {}) {
  return {
    key,
    label: opts.label || key,
    shortLabel: opts.shortLabel || key,
    shape: opts.shape || 'plan',
    group,
    groupTitle: opts.groupTitle || group,
    category,
    badgeText: opts.badgeText || '1',
    unlocked: opts.unlocked ?? false,
    earnedCount: opts.unlocked ? 1 : 0,
    earnDateText: opts.unlocked ? (opts.earnDateText || '2026-01-01') : '',
    pct: opts.unlocked ? 100 : 30,
  };
}

const GROUPS = [
  { key: 'plan', title: '里程碑', category: 'plan' },
  { key: 'rings', title: '合上圆环', category: 'plan' },
  { key: 'record', title: '新纪录', category: 'data' },
  { key: 'activity-type', title: '分运动类型', category: 'data' },
];

const SAMPLE = [
  badge('first', 'plan', 'plan', { unlocked: true, earnDateText: '2026-10-01' }),
  badge('ring-100', 'rings', 'plan', { shape: 'ring' }),
  badge('rec-dist-100', 'record', 'data', { shape: 'dist', unlocked: true, earnDateText: '2026-11-01' }),
  badge('rec-dur-100', 'record', 'data', { shape: 'dur' }),
  badge('run-dist-50', 'activity-type', 'data', { shape: 'dist', unlocked: true, earnDateText: '2026-09-01' }),
];

test('BW1 category=plan 只渲染计划类徽章，且分组只含计划分组', () => {
  const c = bootComponent({ trophies: SAMPLE, groups: GROUPS, category: 'plan' });
  assert.equal(c.data.view.totalCount, 2);
  assert.deepEqual(c.data.view.groups.map((g) => g.title), ['里程碑', '合上圆环']);
});

test('BW2 category=all 渲染全部，分组顺序按服务端 groups', () => {
  const c = bootComponent({ trophies: SAMPLE, groups: GROUPS, category: 'all' });
  assert.equal(c.data.view.totalCount, 5);
  assert.deepEqual(c.data.view.groups.map((g) => g.title), ['里程碑', '合上圆环', '新纪录', '分运动类型']);
});

test('BW3 已获得：按获取日期倒序（最新在前）', () => {
  const c = bootComponent({ trophies: SAMPLE, groups: GROUPS, category: 'all' });
  assert.deepEqual(c.data.view.earnedList.map((t) => t.key), ['rec-dist-100', 'first', 'run-dist-50']);
  assert.equal(c.data.view.earnedCount, 3);
});

test('BW4 未知形状兜底成圆牌，不会白框', () => {
  const c = bootComponent({
    trophies: [badge('x', 'record', 'data', { shape: 'never-seen' })],
    groups: GROUPS,
  });
  const item = c.data.view.groups.find((g) => g.key === 'record').items[0];
  assert.equal(item.cls, 'b-plan');
});

test('BW4b 缺 groups 时按 trophies 出现顺序自建分组（不白屏）', () => {
  const c = bootComponent({
    trophies: [badge('a', 'record', 'data'), badge('b', 'plan', 'plan')],
  });
  assert.deepEqual(c.data.view.groups.map((g) => g.key), ['record', 'plan']);
});

test('BW5 合上圆环用嵌套三环造型（isRing 标记）', () => {
  const c = bootComponent({ trophies: SAMPLE, groups: GROUPS, category: 'all' });
  const ringGroup = c.data.view.groups.find((g) => g.key === 'rings');
  assert.equal(ringGroup.items[0].isRing, true);
  const recGroup = c.data.view.groups.find((g) => g.key === 'record');
  assert.equal(recGroup.items[0].isRing, false);
});

test('BW6 点击抛 select 事件带 key（不自己开弹窗）', () => {
  const c = bootComponent({ trophies: SAMPLE, groups: GROUPS, category: 'all' });
  c.onTapItem({ currentTarget: { dataset: { key: 'ring-100' } } });
  assert.deepEqual(c.events, [{ name: 'select', detail: { key: 'ring-100' } }]);
  c.onTapItem({ currentTarget: { dataset: {} } });
  assert.equal(c.events.length, 1, '无 key 不抛事件');
});

test('BW6b 分运动类型徽章带类型图标（白色变体），普通徽章没有', () => {
  const typed = badge('run-dist-100', 'activity-type', 'data', { shape: 'dist' });
  typed.activityIconId = 'running';
  const plain = badge('ring-100', 'rings', 'plan', { shape: 'ring' });
  const c = bootComponent({ trophies: [typed, plain], groups: GROUPS, category: 'all' });
  const all = c.data.view.groups.flatMap((g) => g.items);
  const runItem = all.find((i) => i.key === 'run-dist-100');
  const ringItem = all.find((i) => i.key === 'ring-100');
  assert.equal(runItem.typeIcon, '/assets/icons/activity-running-white.png', '分类型徽章要带白色类型图标');
  assert.equal(ringItem.typeIcon, '', '普通徽章不叠加图标');
  // 已获得区同样带图标
  const earnedTyped = { ...typed, unlocked: true, earnDateText: '2026-11-01' };
  const c2 = bootComponent({ trophies: [earnedTyped], groups: GROUPS, category: 'all' });
  assert.equal(c2.data.view.earnedList[0].typeIcon, '/assets/icons/activity-running-white.png');
});

test('BW6c 后端没下发 iconId 时不炸，也不渲染图标', () => {
  const t = badge('run-dist-100', 'activity-type', 'data', { shape: 'dist' });
  const c = bootComponent({ trophies: [t], groups: GROUPS, category: 'all' });
  assert.equal(c.data.view.groups[0].items[0].typeIcon, '');
});

test('BW7 空列表不炸', () => {
  const c = bootComponent({ trophies: [], groups: [] });
  assert.deepEqual(c.data.view.groups, []);
  assert.equal(c.data.view.earnedCount, 0);
});

test('BW8 showEarned 开关由 wxml 控制显隐（数据始终算好，切换不用重算）', () => {
  const c = bootComponent({ trophies: SAMPLE, groups: GROUPS, showEarned: false });
  assert.equal(c.data.showEarned, false, '开关要落到组件 data 上给 wxml 用');
  assert.equal(c.data.view.earnedCount, 3);
  const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/components/badge-wall/badge-wall.wxml'), 'utf8');
  assert.ok(wxml.includes('showEarned && view.earnedCount > 0'), '显隐由 showEarned 控制');
});

/* ── 页面 ───────────────────────────────────────────── */
let pageDef = null;
global.Page = (d) => { pageDef = d; };
let nextResponse = () => Promise.resolve({});
const fakeApi = { get: () => nextResponse() };
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };
global.wx = { stopPullDownRefresh() {}, navigateTo() {} };

require('../miniprogram/pages/badges/badges.js');

/** 默认登录态桩：页面 fetch 会先查会话；用例可按需覆盖 */
const ORIG_GET_APP = global.getApp;
global.getApp = () => ({
  globalData: { loggedIn: true },
  hasSession: () => true,
  login: () => Promise.resolve(),
});
after(() => {
  global.getApp = ORIG_GET_APP;
});

function bootPage() {
  const p = Object.assign({}, pageDef);
  p.data = JSON.parse(JSON.stringify(pageDef.data));
  p.setData = (patch, cb) => {
    Object.assign(p.data, patch);
    if (cb) cb();
  };
  return p;
}

const OVERVIEW = {
  total: 5,
  earned: 3,
  categories: [
    { key: 'plan', title: '运动计划', total: 2, earned: 1 },
    { key: 'data', title: '运动数据', total: 3, earned: 2 },
  ],
  groups: GROUPS,
  trophies: SAMPLE.map((t) => ({
    ...t,
    desc: `${t.key} 的说明`,
    detailText: `已达成 1 次 · 目标 1 次`,
    detailLines: [],
  })),
  // 后端仍会下发（统计页复用同一接口），但本页不展示
  activityTypes: [{ type: 'running', label: '跑步', distanceM: 123_400, durationSec: 7300, count: 12 }],
};

test('BP1 装载：拿到总览 + 分类切换默认全部', async () => {
  nextResponse = () => Promise.resolve(OVERVIEW);
  const p = bootPage();
  await p.fetch();
  assert.equal(p.data.data.total, 5);
  assert.equal(p.data.activeFilter, 'all');
  assert.equal(p.data.shownTotal, 5);
  assert.equal(p.data.shownEarned, 3, 'first / rec-dist-100 / run-dist-50 已解锁');
});

test('BP2 切换分类只过滤徽章列表', async () => {
  nextResponse = () => Promise.resolve(OVERVIEW);
  const p = bootPage();
  await p.fetch();
  p.onFilterTap({ currentTarget: { dataset: { key: 'plan' } } });
  assert.equal(p.data.shownTotal, 2);
  assert.equal(p.data.shownEarned, 1);
  assert.ok(p.data.shown.every((t) => t.category === 'plan'));
  p.onFilterTap({ currentTarget: { dataset: { key: 'data' } } });
  assert.equal(p.data.shownTotal, 3);
  assert.equal(p.data.shownEarned, 2, '数据类里 rec-dist-100 / run-dist-50 已解锁');
  assert.ok(p.data.shown.every((t) => t.category === 'data'));
});

test('BP3 页面只展示徽章：不渲染分运动类型统计（那部分在统计页）', async () => {
  nextResponse = () => Promise.resolve(OVERVIEW);
  const p = bootPage();
  await p.fetch();
  // 接口即使仍下发 activityTypes，页面也不应消费它
  assert.equal(p.data.activityTypes, undefined, '页面不再计算分类型概览');
  const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/badges/badges.wxml'), 'utf8');
  // 文件头注释里会出现「分运动类型」（徽章内容说明），只检查渲染节点
  const body = wxml.replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(!body.includes('分运动类型'), 'wxml 渲染部分不应再有分运动类型区块');
  assert.ok(!body.includes('type-item'), '不应再有类型统计行');
  assert.ok(wxml.includes('<badge-wall'), '徽章墙仍在');
});

test('BP4 详情半屏：文案来自服务端 detailText/detailLines', async () => {
  nextResponse = () => Promise.resolve(OVERVIEW);
  const p = bootPage();
  await p.fetch();
  p.onSelect({ detail: { key: 'rec-dist-100' } });
  assert.equal(p.data.trophyDetail.key, 'rec-dist-100');
  assert.deepEqual(p.data.trophyDetail.detailLines, ['已达成 1 次 · 目标 1 次']);
  p.closeTrophyDetail();
  assert.equal(p.data.trophyDetail, null);
});

test('BP4b 详情半屏徽章带形状样式（曾因缺 cls 导致弹窗里徽章没样式）', async () => {
  nextResponse = () => Promise.resolve(OVERVIEW);
  const p = bootPage();
  await p.fetch();
  // 服务端不下发 cls（形状→CSS 是前端的事），页面必须自己翻译
  p.onSelect({ detail: { key: 'rec-dist-100' } });
  assert.equal(p.data.trophyDetail.cls, 'b-shield b-dist', '盾形徽章要有形状类');
  assert.ok(p.data.trophyDetail.badgeText, '要有中央文字');
  assert.equal(p.data.trophyDetail.isRing, false);

  // 圆章（合环）走三环造型
  p.onSelect({ detail: { key: 'ring-100' } });
  assert.equal(p.data.trophyDetail.cls, 'b-ring');
  assert.equal(p.data.trophyDetail.isRing, true, '合环用嵌套三环');

  // 时长纪录六边形
  p.onSelect({ detail: { key: 'rec-dur-100' } });
  assert.equal(p.data.trophyDetail.cls, 'b-hex b-dur', '六边形徽章要有形状类');
});

test('BP4c 未知形状在弹窗里也兜底成圆牌，不白框', async () => {
  const weird = { ...SAMPLE[2], key: 'weird', shape: 'never-seen' };
  nextResponse = () => Promise.resolve({ ...OVERVIEW, trophies: [weird] });
  const p = bootPage();
  await p.fetch();
  p.onSelect({ detail: { key: 'weird' } });
  assert.equal(p.data.trophyDetail.cls, 'b-plan');
});

test('BP4d 分类型徽章在弹窗里也带类型图标', async () => {
  const typed = { ...SAMPLE[3], key: 'run-dist-100', activityIconId: 'running' };
  nextResponse = () => Promise.resolve({ ...OVERVIEW, trophies: [typed] });
  const p = bootPage();
  await p.fetch();
  p.onSelect({ detail: { key: 'run-dist-100' } });
  assert.equal(p.data.trophyDetail.typeIcon, '/assets/icons/activity-running-white.png');
});

test('BP5 接口失败：failed 置位、不炸', async () => {
  nextResponse = () => Promise.reject(new Error('boom'));
  const p = bootPage();
  await p.fetch();
  assert.equal(p.data.failed, true);
  assert.equal(p.data.loading, false);
});

test('BP6 页面已注册到 app.json 且组件挂载正确', () => {
  const app = JSON.parse(fs.readFileSync(path.join(__dirname, '../miniprogram/app.json'), 'utf8'));
  assert.ok(app.pages.includes('pages/badges/badges'), 'pages/badges 未注册');
  const pageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../miniprogram/pages/badges/badges.json'), 'utf8'));
  assert.equal(pageJson.usingComponents['badge-wall'], '/components/badge-wall/badge-wall');
  const planJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../miniprogram/pages/plan-history/plan-history.json'), 'utf8'));
  assert.equal(planJson.usingComponents['badge-wall'], '/components/badge-wall/badge-wall', '计划页也挂载同一组件');
});
/* 分享（2026-11-17）：微信侧「分享给朋友 / 分享到朋友圈」入口依赖这两个钩子存在，
   少了任何一个，右上角菜单里的对应项就是灰的（实测踩过）。 */
test('BP7 支持分享给朋友：标题带已获得进度', async () => {
  nextResponse = () => Promise.resolve(OVERVIEW);
  const p = bootPage();
  await p.fetch();
  assert.equal(typeof pageDef.onShareAppMessage, 'function', '缺 onShareAppMessage 会导致「发送给」不可用');
  const r = pageDef.onShareAppMessage.call(p);
  assert.match(r.title, /我的运动徽章 · 已点亮 3\/5 座/, `标题应带进度：${r.title}`);
  assert.equal(r.path, '/pages/badges/badges');
});

test('BP8 支持分享到朋友圈：标题同样带进度', async () => {
  assert.equal(typeof pageDef.onShareTimeline, 'function', '缺 onShareTimeline 会导致「分享到朋友圈」不可用');
  nextResponse = () => Promise.resolve(OVERVIEW);
  const p = bootPage();
  await p.fetch();
  const r = pageDef.onShareTimeline.call(p);
  assert.match(r.title, /我的运动徽章 · 已点亮 3\/5 座/);
  assert.equal(r.query, '', '单页模式不需要查询参数');
});

test('BP9 数据未加载时分享不炸（标题退化为无进度版本）', () => {
  const p = bootPage();
  // 未 fetch，data.data 为 null
  const r1 = pageDef.onShareAppMessage.call(p);
  assert.equal(r1.title, '我的运动徽章');
  const r2 = pageDef.onShareTimeline.call(p);
  assert.equal(r2.title, '我的运动徽章');
});

/* 游客态（2026-11-17）：/plan/badges 需要登录（401），未登录不能显示「加载失败」。
   页面应先判断会话，直接展示登录引导，且不发起请求。 */

test('BP10 游客访问：不请求接口、不显示加载失败，展示登录引导', async () => {
  const p = bootPage();
  let called = 0;
  global.getApp = () => ({
    globalData: { loggedIn: false },
    hasSession: () => false,
    login: () => Promise.resolve(),
  });
  const orig = nextResponse;
  nextResponse = () => { called += 1; return Promise.resolve(OVERVIEW); };
  try {
    await p.fetch();
    assert.equal(called, 0, '游客态不该发起 /plan/badges 请求');
    assert.equal(p.data.notLoggedIn, true, '应标记游客态');
    assert.equal(p.data.failed, false, '不该显示「加载失败」');
    assert.equal(p.data.loading, false);
  } finally {
    nextResponse = orig;
  }
});

test('BP11 接口返回 401（会话过期）也按游客态处理，不是加载失败', async () => {
  const p = bootPage();
  global.getApp = () => ({
    globalData: { loggedIn: true },
    hasSession: () => true,
    login: () => Promise.resolve(),
  });
  const orig = nextResponse;
  nextResponse = () => Promise.reject(Object.assign(new Error('未授权'), { statusCode: 401 }));
  try {
    await p.fetch();
    assert.equal(p.data.notLoggedIn, true, '401 应识别为游客态');
    assert.equal(p.data.failed, false, '不该显示「加载失败」');
  } finally {
    nextResponse = orig;
  }
});

/**
 * 统计页半屏弹窗（全部纪录 / 奖杯详情）：开合、默认类型、未解锁不跳转。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = {
  id: apiPath,
  filename: apiPath,
  loaded: true,
  exports: { get: () => Promise.resolve({}) },
  children: [],
  paths: [],
};

const navCalls = [];
global.wx = { navigateTo: (opts) => navCalls.push(opts.url) };
let pageDef = null;
global.Page = (def) => { pageDef = def; };
global.getApp = () => ({ globalData: {} });

require('../miniprogram/pages/stats/stats.js');

function makePage(data = {}) {
  const page = Object.create(pageDef);
  page.data = {
    sheetVisible: false,
    sheetType: 'best',
    best: { bestCards: [{ id: 'rec-1' }] },
    trophies: [
      { key: '5k', id: 'tr-1', unlocked: true },
      { key: 'full', id: '', unlocked: false },
    ],
    ...data,
  };
  page.setData = function (patch) {
    Object.assign(this.data, patch);
  };
  return page;
}

test('SS1 打开弹窗：按 data-type 切换，非法值回落到全部纪录', () => {
  const page = makePage();
  page.openSheet({ currentTarget: { dataset: { type: 'trophy' } } });
  assert.equal(page.data.sheetVisible, true);
  assert.equal(page.data.sheetType, 'trophy');

  page.closeSheet();
  page.openSheet({ currentTarget: { dataset: { type: 'whatever' } } });
  assert.equal(page.data.sheetVisible, true);
  assert.equal(page.data.sheetType, 'best');
});

test('SS2 关闭弹窗', () => {
  const page = makePage({ sheetVisible: true });
  page.closeSheet();
  assert.equal(page.data.sheetVisible, false);
});

test('SS3 未解锁奖杯无 id：不跳转、弹窗保持打开', () => {
  navCalls.length = 0;
  const page = makePage({ sheetVisible: true, sheetType: 'trophy' });
  page.onSheetTrack({ currentTarget: { dataset: { id: '' } } });
  assert.equal(navCalls.length, 0);
  assert.equal(page.data.sheetVisible, true);
});

test('SS4 点已解锁卡片：先关弹窗再进轨迹详情', () => {
  navCalls.length = 0;
  const page = makePage({ sheetVisible: true, sheetType: 'trophy' });
  page.onSheetTrack({ currentTarget: { dataset: { id: 'tr-1' } } });
  assert.equal(page.data.sheetVisible, false);
  assert.deepEqual(navCalls, ['/pages/track-detail/track-detail?id=tr-1']);
});

test('SS5 奖杯详情文案：类型 / 达成日期 / 保持天数 / 未解锁要求', () => {
  const now = Date.now();
  const page = makePage();
  const list = page.decorateTrophies({
    milestones: [
      { key: '5k', id: 'tr-1', sec: 1500, type: 'running', startTime: now },
      { key: 'half', id: 'tr-2', sec: 7200, type: 'walking', startTime: now - 30 * 86400000 },
    ],
  });
  const byKey = new Map(list.map((t) => [t.key, t]));
  assert.equal(byKey.get('5k').typeLabel, '跑步');
  assert.equal(byKey.get('5k').heldText, '今天达成');
  assert.equal(byKey.get('half').typeLabel, '散步');
  assert.match(byKey.get('half').heldText, /^已保持 \d+ 天$/);
  assert.match(byKey.get('5k').dateText, /^\d{4}\/\d{2}\/\d{2}$/);
  assert.equal(byKey.get('full').unlocked, false);
  assert.equal(byKey.get('full').requirementText, '完成 42.2 km');
});

test('SS6 最佳记录卡补运动类型文案（宫格用）', () => {
  const page = makePage();
  const best = page.decorateBest({
    minPaceByType: [{ type: 'running', fastestKm: 600, id: 'r1' }],
  });
  const card = best.bestCards.find((c) => c.label === '最快配速');
  assert.equal(card.typeLabel, '跑步');
});

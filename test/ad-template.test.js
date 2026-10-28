/**
 * components/ad-template：原生模板广告（<ad-custom>）外层组件。
 * 展示条件 = 后台在架（能按 slot 取到 unit-id） 且 未免广告期；任一不满足都不渲染。
 * 运行：npm test（node --test 自动发现）；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const storage = new Map();
global.wx = {
  getStorageSync: (k) => (storage.has(k) ? storage.get(k) : ''),
  setStorageSync: (k, v) => { storage.set(k, v); },
};

let nextResult = { items: [] };
require.cache[require.resolve('../miniprogram/services/api.js')] = {
  id: 'fake-ads-api-2', filename: 'fake-ads-api-2', loaded: true,
  exports: { get: () => Promise.resolve(nextResult) },
  children: [], paths: [],
};

const adFree = require('../miniprogram/utils/ad-free.js');
const adSlots = require('../miniprogram/utils/ad-slots.js');

let compDef = null;
global.Component = (def) => { compDef = def; };
require('../miniprogram/components/ad-template/ad-template.js');
assert.ok(compDef, 'ad-template.js 应通过 Component() 交出组件对象');

const SLOT = 'home_bottom';
const UNIT = 'adunit-eb146f52cea54541';

/** 预置一份新鲜的广告位缓存（避免 mount 时还要等异步） */
function seedSlots(items) {
  storage.set(adSlots.STORAGE_KEY, { ts: Date.now(), items });
}
const tick = () => new Promise((r) => setTimeout(r, 0));

function mount(slot) {
  const c = Object.assign({}, compDef.methods);
  c.data = Object.assign({}, compDef.data, { adslot: slot, intervals: 30 });
  c.events = [];
  c.setData = (patch) => Object.assign(c.data, patch);
  c.triggerEvent = (name, detail) => c.events.push([name, detail]);
  compDef.lifetimes.attached.call(c);
  return c;
}

test('AT1 slot 为空不渲染（没指定广告位就别猜）', async () => {
  storage.clear();
  seedSlots({ [SLOT]: UNIT });
  const c = mount('');
  await tick();
  assert.equal(c.data.show, false);
  compDef.lifetimes.detached.call(c);
});

test('AT2 后台在架且未免广告 → 渲染，unit-id 用后台下发的', async () => {
  storage.clear();
  adFree.setAdFreeUntil(0);
  seedSlots({ [SLOT]: UNIT });
  const c = mount(SLOT);
  await tick();
  assert.equal(c.data.show, true);
  assert.equal(c.data.unitId, UNIT);
  compDef.lifetimes.detached.call(c);
});

test('AT3 免广告期不渲染；权益清掉后自动恢复（订阅）', async () => {
  storage.clear();
  seedSlots({ [SLOT]: UNIT });
  adFree.setAdFreeUntil(Date.now() + 60000);
  const c = mount(SLOT);
  await tick();
  assert.equal(c.data.show, false, '有免广告卡就不该渲染广告');

  adFree.setAdFreeUntil(0);
  assert.equal(c.data.show, true, '权益清掉后要自动恢复');
  compDef.lifetimes.detached.call(c);
});

test('AT4 后台把广告位下架（重新拉取后取不到 unit-id）→ 组件自动隐藏', async () => {
  storage.clear();
  adFree.setAdFreeUntil(0);
  seedSlots({ [SLOT]: UNIT });
  const c = mount(SLOT);
  await tick();
  assert.equal(c.data.show, true);

  nextResult = { items: [] };
  await adSlots.refreshAdSlots(true);
  await tick();
  assert.equal(c.data.show, false, '后台关了开关，端上最多一个 TTL 就该消失');
  compDef.lifetimes.detached.call(c);
});

test('AT5 页面重新显示时重算（卡可能在这期间过期/inactive 变化）', async () => {
  storage.clear();
  seedSlots({ [SLOT]: UNIT });
  const c = mount(SLOT);
  await tick();
  assert.equal(c.data.show, true);

  adFree.setAdFreeUntil(Date.now() + 60000);
  c.data.show = true; // 模拟订阅之前的状态，专测 pageLifetimes.show 自身
  compDef.pageLifetimes.show.call(c);
  assert.equal(c.data.show, false);
  compDef.lifetimes.detached.call(c);
  adFree.setAdFreeUntil(0);
});

test('AT6 加载失败收掉整块并向上抛 error；wxml 用 ad-custom 绑解析后的 unit-id', async () => {
  storage.clear();
  adFree.setAdFreeUntil(0);
  seedSlots({ [SLOT]: UNIT });
  const c = mount(SLOT);
  await tick();
  compDef.methods.onAdError.call(c, { detail: { errCode: 1002 } });
  assert.equal(c.data.show, false, '无库存/单元无效时别留空白占位');
  assert.deepEqual(c.events, [['error', { errCode: 1002 }]]);
  compDef.lifetimes.detached.call(c);

  const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/components/ad-template/ad-template.wxml'), 'utf8');
  assert.ok(wxml.includes('<ad-custom'), '原生模板广告是 ad-custom 组件');
  assert.ok(wxml.includes('unit-id="{{unitId}}"'), 'unit-id 来自后台下发（slot 解析）');
  assert.ok(wxml.includes('binderror="onAdError"'));
});

test('AT7 detached 后不再响应状态变化（避免对已销毁实例 setData）', async () => {
  storage.clear();
  adFree.setAdFreeUntil(Date.now() + 60000);
  seedSlots({ [SLOT]: UNIT });
  const c = mount(SLOT);
  await tick();
  assert.equal(c.data.show, false);
  compDef.lifetimes.detached.call(c);

  adFree.setAdFreeUntil(0);
  assert.equal(c.data.show, false, 'detached 后权益变化也不该再动它');
});

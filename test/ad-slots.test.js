/**
 * utils/ad-slots：广告位缓存（后台在架项）与取数节流。
 * 接口用 require.cache 注入假实现；缓存放内存 Map 里模拟 wx.storage。
 * 运行：npm test（node --test 自动发现）；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const storage = new Map();
global.wx = {
  getStorageSync: (k) => (storage.has(k) ? storage.get(k) : ''),
  setStorageSync: (k, v) => { storage.set(k, v); },
};

let calls = 0;
let nextResult = { items: [] };
let nextError = null;
require.cache[require.resolve('../miniprogram/services/api.js')] = {
  id: 'fake-ads-api', filename: 'fake-ads-api', loaded: true,
  exports: {
    get(url) {
      calls += 1;
      assert.equal(url, '/ads');
      return nextError ? Promise.reject(new Error(nextError)) : Promise.resolve(nextResult);
    },
  },
  children: [], paths: [],
};

const slots = require('../miniprogram/utils/ad-slots.js');
const tick = () => new Promise((r) => setTimeout(r, 0));

test('AS1 缓存未就绪取不到广告位；拉取后按 key 取 unit-id，并落盘带时间戳', async () => {
  storage.clear();
  calls = 0;
  nextError = null;
  nextResult = { items: [{ key: 'home_bottom', unitId: 'adunit-eb146f52cea54541' }] };
  assert.equal(slots.getAdSlot('home_bottom'), '');

  await slots.refreshAdSlots();
  assert.equal(calls, 1);
  assert.equal(slots.getAdSlot('home_bottom'), 'adunit-eb146f52cea54541');
  assert.equal(slots.getAdSlot('unknown'), '', '没配的位取不到');
  const cache = storage.get('ad_slots');
  assert.ok(cache && Number.isFinite(cache.ts), '缓存要带时间戳（TTL 判定用）');
});

test('AS2 缓存新鲜时不重复请求；过期才重拉；force 强制重拉', async () => {
  storage.clear();
  calls = 0;
  nextResult = { items: [{ key: 'home_bottom', unitId: 'adunit-aaaaaaaaaaaaaaaa' }] };
  await slots.refreshAdSlots();
  assert.equal(calls, 1);

  await slots.refreshAdSlots();
  assert.equal(calls, 1, '5 分钟内不该再请求');

  // 手动把时间戳改老 → 过期
  const cache = storage.get('ad_slots');
  storage.set('ad_slots', { ts: cache.ts - slots.TTL_MS - 1000, items: cache.items });
  nextResult = { items: [{ key: 'home_bottom', unitId: 'adunit-bbbbbbbbbbbbbbbb' }] };
  await slots.refreshAdSlots();
  assert.equal(calls, 2);
  assert.equal(slots.getAdSlot('home_bottom'), 'adunit-bbbbbbbbbbbbbbbb', '过期后要用新配置');

  await slots.refreshAdSlots(true);
  assert.equal(calls, 3, 'force 不看 TTL');
});

test('AS3 后台下架：拉回来的集合里没有这个位 → 取不到（组件随之不渲染）', async () => {
  storage.clear();
  nextResult = { items: [{ key: 'home_bottom', unitId: 'adunit-aaaaaaaaaaaaaaaa' }] };
  await slots.refreshAdSlots(true);
  assert.equal(slots.getAdSlot('home_bottom'), 'adunit-aaaaaaaaaaaaaaaa');

  nextResult = { items: [] };
  await slots.refreshAdSlots(true);
  assert.equal(slots.getAdSlot('home_bottom'), '', '下架后不该还拿到旧的 unit-id');
});

test('AS4 请求失败保留旧缓存（一次抖动不把所有广告都关掉），且不抛错', async () => {
  storage.clear();
  nextError = null;
  nextResult = { items: [{ key: 'home_bottom', unitId: 'adunit-cccccccccccccccc' }] };
  await slots.refreshAdSlots(true);

  nextError = '网络不给力';
  await slots.refreshAdSlots(true);
  assert.equal(slots.getAdSlot('home_bottom'), 'adunit-cccccccccccccccc');
  nextError = null;
});

test('AS5 并发只发一个请求；拉取成功通知订阅者，退订后不再收到', async () => {
  storage.clear();
  calls = 0;
  nextResult = { items: [{ key: 'home_bottom', unitId: 'adunit-dddddddddddddddd' }] };
  let hits = 0;
  const off = slots.onAdSlotsChange(() => { hits += 1; });
  await Promise.all([slots.refreshAdSlots(true), slots.refreshAdSlots(true), slots.refreshAdSlots(true)]);
  await tick();
  assert.equal(calls, 1, '三个组件同时 attach 也只打一个请求');
  assert.equal(hits, 1);
  off();
  await slots.refreshAdSlots(true);
  assert.equal(hits, 1, '退订后不再通知');
});

test('AS6 启动时拉一次：app.onLaunch 必须调用 refreshAdSlots（否则组件只能等自己 attach）', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const app = fs.readFileSync(path.join(__dirname, '../miniprogram/app.js'), 'utf8');
  assert.ok(/refreshAdSlots\(\)/.test(app));
});

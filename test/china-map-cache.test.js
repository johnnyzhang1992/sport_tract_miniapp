/**
 * 中国省界 GeoJSON 的进程内缓存（api.getChinaMap）。
 *
 * 背景：体验评分把 /geo/china-map 判为无缓存请求。这份数据静态、体积大，
 * 榜单 / 足迹统计 / 足迹地图三处都要用；接口侧已加 Cache-Control，
 * 端上再合并一次：同一会话只发一次，并发的多个调用共用同一个在途请求。
 * 失败不能缓存（否则地图页一次抖动就整会话打不开）。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'miniprogram');
const CONFIG = path.join(ROOT, 'config', 'index.js');
const STORAGE = path.join(ROOT, 'services', 'storage.js');
const API = path.join(ROOT, 'services', 'api.js');

/** 每次调用都重新加载 api.js：清掉模块级缓存与在途 Promise，用例互不干扰 */
function loadApi(requestImpl) {
  delete require.cache[API];
  require.cache[CONFIG] = {
    id: CONFIG, filename: CONFIG, loaded: true, children: [], paths: [],
    exports: { API_BASE_URL: 'https://api.test' },
  };
  require.cache[STORAGE] = {
    id: STORAGE, filename: STORAGE, loaded: true, children: [], paths: [],
    exports: { getToken: () => null },
  };
  global.wx = { request: requestImpl };
  // 与 require.cache[API] 同一绝对路径（require.cache 以解析后的文件名为键），缓存剔除不受影响
  return require('../miniprogram/services/api.js');
}

const okRequest = (counter) => (opts) => {
  counter.n += 1;
  opts.success({ statusCode: 200, data: { success: true, data: { type: 'FeatureCollection', tag: counter.n } } });
};

test('CM1 并发调用只发一次请求，结果共享', async () => {
  const counter = { n: 0 };
  const api = loadApi(okRequest(counter));
  const [a, b] = await Promise.all([api.getChinaMap(), api.getChinaMap()]);
  assert.equal(counter.n, 1, '在途请求应合并');
  assert.deepEqual(a, b);
  assert.equal(a.type, 'FeatureCollection');
});

test('CM2 成功后再次调用命中缓存，不再发请求', async () => {
  const counter = { n: 0 };
  const api = loadApi(okRequest(counter));
  const first = await api.getChinaMap();
  const second = await api.getChinaMap();
  assert.equal(counter.n, 1);
  assert.deepEqual(first, second);
});

test('CM3 失败不缓存：下一次调用会重试', async () => {
  const counter = { n: 0 };
  const api = loadApi((opts) => {
    counter.n += 1;
    if (counter.n === 1) {
      opts.fail({ errMsg: 'request:fail timeout' });
      return;
    }
    opts.success({ statusCode: 200, data: { success: true, data: { type: 'FeatureCollection' } } });
  });
  await assert.rejects(() => api.getChinaMap());
  const map = await api.getChinaMap();
  assert.equal(counter.n, 2, '失败后应允许重试');
  assert.equal(map.type, 'FeatureCollection');
});

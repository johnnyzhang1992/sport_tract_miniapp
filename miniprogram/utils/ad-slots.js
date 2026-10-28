/**
 * 广告位（端上缓存）：小程序按 slot key 取 unit-id。
 *
 * 真值来自公开接口 GET /ads（只含在架项）。后台把广告位下架/删掉后，最迟一个 TTL 周期后生效；
 * 端上不需要登录，游客也拉得到。组件 attached / 页面 show 时调 refreshAdSlots()，缓存新鲜就不重复请求。
 *
 * 展示条件 = 后台在架（这里取得到 unitId） 且 未免广告期（utils/ad-free）——任一不满足就不渲染。
 */
const api = require('../services/api');

const STORAGE_KEY = 'ad_slots';
const TTL_MS = 5 * 60 * 1000;
const listeners = [];
let inflight = null;

function readCache() {
  const raw = wx.getStorageSync(STORAGE_KEY);
  if (!raw || typeof raw !== 'object' || !raw.items || typeof raw.items !== 'object') return null;
  return raw;
}

/** 取某广告位的 unit-id；未配置 / 已下架 / 还没拉到 → 空串 */
function getAdSlot(key) {
  if (!key) return '';
  const cache = readCache();
  const unitId = cache && cache.items[key];
  return typeof unitId === 'string' ? unitId : '';
}

function isFresh(cache, now) {
  return !!(cache && Number.isFinite(cache.ts) && now - cache.ts < TTL_MS);
}

/** 订阅广告位变化（拉取成功后通知组件重算），返回退订函数 */
function onAdSlotsChange(fn) {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

/**
 * 拉一次在架广告位写进缓存。
 * - 默认缓存新鲜就跳过；force=true 强制重拉
 * - 并发只发一个请求（多个组件同时 attach 不会打一串）
 * - 失败静默：保留旧缓存（一次网络抖动不该把所有广告都关掉，也不挡页面）
 */
function refreshAdSlots(force) {
  if (inflight) return inflight;
  if (!force && isFresh(readCache(), Date.now())) return Promise.resolve();
  inflight = api
    .get('/ads')
    .then((res) => {
      const items = {};
      for (const it of (res && res.items) || []) {
        if (it && typeof it.key === 'string' && typeof it.unitId === 'string' && it.unitId) {
          items[it.key] = it.unitId;
        }
      }
      wx.setStorageSync(STORAGE_KEY, { ts: Date.now(), items });
      for (const fn of listeners.slice()) fn();
    })
    .catch(() => {})
    .then(() => {
      inflight = null;
    });
  return inflight;
}

module.exports = { getAdSlot, refreshAdSlots, onAdSlotsChange, STORAGE_KEY, TTL_MS };

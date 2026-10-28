/**
 * 免广告权益（端上缓存）：广告组件与积分页共用。
 *
 * 真值来源是服务端，两处同一字段：
 * - 登录响应 user.adFreeUntil（每次启动静默登录都会带回来，不用额外请求）
 * - 积分页 /points/summary 的 adFreeUntil（兑换/激活/到期后回到积分页即可刷新）
 *
 * 这里只做三件事：落盘缓存（重启小程序仍生效）、按到期时刻判定、变化时通知已挂载的广告组件。
 */
const STORAGE_KEY = 'ad_free_until';
const listeners = [];

/** 免广告到期时刻（epoch ms）；无权益 / 脏数据一律 0 */
function getAdFreeUntil() {
  const raw = wx.getStorageSync(STORAGE_KEY);
  const ts = Number(raw);
  return Number.isFinite(ts) && ts > 0 ? ts : 0;
}

/** 写缓存并通知订阅者（值没变就不重复通知） */
function setAdFreeUntil(ts) {
  const next = Number(ts);
  const value = Number.isFinite(next) && next > 0 ? next : 0;
  if (value === getAdFreeUntil()) return;
  wx.setStorageSync(STORAGE_KEY, value);
  for (const fn of listeners.slice()) fn(value);
}

/** 当前是否处于免广告期（到期时刻当刻即失效） */
function isAdFree(now) {
  return getAdFreeUntil() > (now || Date.now());
}

/** 订阅变化，返回退订函数（组件 detached 时必须调，别对已销毁实例 setData） */
function onAdFreeChange(fn) {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

module.exports = { getAdFreeUntil, setAdFreeUntil, isAdFree, onAdFreeChange, STORAGE_KEY };

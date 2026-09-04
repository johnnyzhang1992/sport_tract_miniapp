/**
 * 本地缓存（决策：本地存储用户态、待同步队列、设置）
 */
const TOKEN_KEY = 'sport_track_token';
const USER_KEY = 'sport_track_user';

function safeGet(key) {
  try {
    return wx.getStorageSync(key);
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    wx.setStorageSync(key, value);
  } catch {
    // 存储失败静默（如隐私模式）
  }
}

function setToken(accessToken, refreshToken) {
  safeSet(TOKEN_KEY, { accessToken, refreshToken });
}

function getToken() {
  return safeGet(TOKEN_KEY) || null;
}

const PROFILE_GUIDE_KEY = 'sport_track_profile_guide';

/** 标记某用户已处理完善资料引导（跳过/已完善）；按 userId 记，避免同机多用户互相抑制 */
function setProfileGuideDone(userId) {
  safeSet(PROFILE_GUIDE_KEY, { done: true, userId: userId || '', ts: Date.now() });
}

/**
 * 某用户是否已处理过引导。
 * 历史版本存的是无 userId 的全局标记 —— 视为未处理（让老用户/测试环境重新弹一次）
 */
function getProfileGuideDone(userId) {
  const v = safeGet(PROFILE_GUIDE_KEY);
  if (!userId) return !!(v && v.done);
  return !!(v && v.done && v.userId === userId);
}

function clearToken() {
  try {
    wx.removeStorageSync(TOKEN_KEY);
  } catch {
    // ignore
  }
}

function setUser(user) {
  safeSet(USER_KEY, user);
}

function getUser() {
  return safeGet(USER_KEY) || null;
}

/** 个人最佳缓存（打破纪录提示用；key 带 userId 防串用户） */
function bestCacheKey(userId) {
  return `best_records_cache_${userId || 'anon'}`;
}
function getBestCache(userId) {
  return wx.getStorageSync(bestCacheKey(userId)) || null;
}
function setBestCache(userId, data) {
  wx.setStorageSync(bestCacheKey(userId), data);
}
function clearBestCache(userId) {
  wx.removeStorageSync(bestCacheKey(userId));
}

module.exports = { setToken, getToken, clearToken, setUser, getUser, getProfileGuideDone, setProfileGuideDone, getBestCache, setBestCache, clearBestCache };

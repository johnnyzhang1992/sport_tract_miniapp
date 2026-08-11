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

module.exports = { setToken, getToken, clearToken, setUser, getUser };

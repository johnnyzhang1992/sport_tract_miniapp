/**
 * 首页广告每日展示上限（冷启动口径）。
 *
 * 规则：同一用户同一天最多展示 3 次；每次冷启动 onLaunch 记 1 次，
 * 切 tab / 从其它页返回首页不再计数。存本地 storage，按「登录用户 ID + 东八区日期」，
 * 游客按设备（uid 空）单独计数；日期或 uid 变了就从头算。
 *
 * 结果只在启动时算一次（app.globalData.homeAdAllowed），首页据此给 ad-template 传 blocked。
 */
const storage = require('../services/storage');
const { bjDate } = require('./bj-date');

const STORAGE_KEY = 'homeAdLaunchesV1';
/** 每天最多展示次数（含 onLaunch 当次） */
const DAILY_LIMIT = 3;

/** 从 JWT payload 里解 userId；无 token / 坏 token 视为游客 */
function userIdFromToken(accessToken) {
  if (!accessToken) return '';
  try {
    let b64 = String(accessToken).split('.')[1] || '';
    if (!b64) return '';
    b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bytes = new Uint8Array(wx.base64ToArrayBuffer(b64));
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    const payload = JSON.parse(s);
    return payload && payload.userId ? String(payload.userId) : '';
  } catch (e) {
    return '';
  }
}

/** 当前登录用户 id（同步解 token，避免等异步静默登录）；游客返回 '' */
function currentUserId() {
  const t = storage.getToken();
  return userIdFromToken(t && t.accessToken);
}

function readState() {
  try {
    const v = wx.getStorageSync(STORAGE_KEY);
    return v && typeof v === 'object' ? v : null;
  } catch (e) {
    return null;
  }
}

/**
 * 记一次冷启动，返回本次启动后是否仍允许展示首页广告。
 * 存储异常时仍返回本次结果（不阻断启动）。
 */
function recordLaunch(uid, now) {
  const userId = uid ? String(uid) : '';
  const date = bjDate(now || Date.now());
  const prev = readState();
  const same = !!prev && prev.date === date && (prev.uid || '') === userId;
  const count = (same ? Number(prev.count) || 0 : 0) + 1;
  try {
    wx.setStorageSync(STORAGE_KEY, { date, uid: userId, count });
  } catch (e) {
    // 存储失败只影响下次启动的计数
  }
  return count <= DAILY_LIMIT;
}

module.exports = { STORAGE_KEY, DAILY_LIMIT, recordLaunch, userIdFromToken, currentUserId };

/**
 * 微信运动步数同步（调研：docs/20-微信步数接口调研.md）。
 *
 * 链路：隐私检查 → scope.werun 授权 → wx.login 取 code → wx.getWeRunData 取加密数据
 *       → POST /werun/sync（服务端现换 session_key 解密落库，session_key 用完即弃，同 xpay 时序）。
 * 解密失败（409）= 登录后 session_key 轮换过：自动重取新 code 再试一次。
 *
 * 本模块只做链路、不做 UI：永不 toast、永不主动弹窗——
 * requestAuth=false（默认）全程静默，任何一步不满足直接返回原因，供调用方决定要不要引导；
 * requestAuth=true 才允许拉起隐私弹窗/授权弹窗（给将来的步数任务触点用）。
 * 微信运动数据在「用户进入小程序时」才更新（官方口径），当天步数有滞后是正常现象。
 */
const api = require('../services/api');

const SCOPE_WERUN = 'scope.werun';

/** 并发去重：积分页 onLoad/onShow/下拉刷新会连发，只留第一趟 */
let inFlight = null;

/** callback 风格 API → Promise */
function promisify(fn, options = {}) {
  return new Promise((resolve, reject) => {
    fn(Object.assign({}, options, { success: resolve, fail: reject }));
  });
}

/** 隐私状态：'pass' 已同意/无需弹窗；'need' 需要用户同意隐私协议 */
function checkPrivacy() {
  return new Promise((resolve) => {
    // 低版本基础库没有 getPrivacySetting：官方口径视为无需处理
    if (!wx.getPrivacySetting) return resolve('pass');
    wx.getPrivacySetting({
      success: (res) => resolve(res.needAuthorization ? 'need' : 'pass'),
      fail: () => resolve('pass'), // 查询失败不拦业务：真正的拦截在 getWeRunData 的授权/调用失败上
    });
  });
}

function requirePrivacy() {
  if (!wx.requirePrivacyAuthorize) return Promise.resolve(false);
  return promisify(wx.requirePrivacyAuthorize).then(
    () => true,
    () => false,
  );
}

/** scope.werun 当前状态：true 已授权 / false 曾拒绝 / undefined 从未问过（authSetting 原生就是三态） */
function getScopeState() {
  // 极老基础库没有 getSetting：按「没问过」处理，由调用方决定要不要引导
  if (!wx.getSetting) return Promise.resolve(undefined);
  return promisify(wx.getSetting).then((res) => (res.authSetting ? res.authSetting[SCOPE_WERUN] : undefined));
}

/** 判定「用户微信里没开微信运动」——官方无专用错误码，社区口径 errMsg 含 no data */
function isWeRunDisabled(err) {
  const msg = (err && err.errMsg) || '';
  return /no\s*data|werun.*(not|no).*(open|enable|data)/i.test(msg);
}

/** 单趟取数上报：wx.login（code 与后续解密的 session_key 绑定）→ 取数 → 上报 */
async function fetchAndReport() {
  const login = await promisify(wx.login);
  // getWeRunData 官方标注不支持 Promise 风格，只能回调，这里统一包装
  const run = await promisify(wx.getWeRunData).catch((e) => {
    if (isWeRunDisabled(e)) return { __disabled: true };
    throw e;
  });
  if (run.__disabled) return { ok: false, reason: 'disabled' };
  const data = await api.post('/werun/sync', {
    code: login.code,
    encryptedData: run.encryptedData,
    iv: run.iv,
  });
  return { ok: true, syncedDays: data.syncedDays, days: data.days };
}

/**
 * 同步微信运动步数到后端。
 * @param {object} [opts]
 * @param {boolean} [opts.requestAuth=false] 不满足前置条件时是否允许拉起弹窗（隐私/授权）
 * @returns {Promise<{ok: true, syncedDays: number, days?: Array}|{ok: false, reason: string, message?: string}>}
 *   reason: busy / privacy / privacy-denied / scope / denied / disabled / failed
 */
async function syncWeRunSteps({ requestAuth = false } = {}) {
  if (inFlight) return { ok: false, reason: 'busy' };
  inFlight = (async () => {
    try {
      // 1 隐私协议：需要同意且本趟不允许弹窗 → 交给调用方引导
      if ((await checkPrivacy()) === 'need') {
        if (!requestAuth) return { ok: false, reason: 'privacy' };
        if (!(await requirePrivacy())) return { ok: false, reason: 'privacy-denied' };
      }
      // 2 scope.werun：undefined（没问过）→ authorize 弹窗；false（拒绝过）→ authorize 直接 fail，得走 openSetting
      const scopeState = await getScopeState();
      if (scopeState !== true) {
        if (!requestAuth) return { ok: false, reason: 'scope' };
        const granted = await promisify(wx.authorize, { scope: SCOPE_WERUN }).then(
          () => true,
          () => false,
        );
        if (!granted) return { ok: false, reason: 'denied' };
      }
      // 3 取数上报；409（session_key 轮换）自动换新 code 重试一趟
      try {
        return await fetchAndReport();
      } catch (e) {
        if (e && e.statusCode === 409) return await fetchAndReport();
        throw e;
      }
    } catch (e) {
      return { ok: false, reason: 'failed', message: (e && e.message) || '同步失败' };
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * 授权总状态（进入页面前置检查用）：
 * - 'privacy'  需先同意隐私协议（getWeRunData 之前必须过这一关）
 * - 'granted'  已授权，可直接静默同步
 * - 'denied'   曾拒绝 scope.werun —— wx.authorize 再调也会直接失败，只能引导去设置页
 * - 'unasked'  从未问过，弹一次 authorize 即可
 */
async function getWeRunAuthState() {
  if ((await checkPrivacy()) === 'need') return 'privacy';
  const scope = await getScopeState();
  if (scope === true) return 'granted';
  if (scope === false) return 'denied';
  return 'unasked';
}

/** 打开小程序设置页（曾拒绝授权的唯一出路）；返回 scope.werun 是否已打开 */
function openWeRunSetting() {
  return promisify(wx.openSetting).then(
    (res) => !!(res && res.authSetting && res.authSetting[SCOPE_WERUN]),
    () => false,
  );
}

/** 设置页「同步微信步数」：缺字段（老用户）按开启处理 */
function isDailyStepSyncOn() {
  const app = getApp();
  const settings = app && app.globalData && app.globalData.userInfo && app.globalData.userInfo.settings;
  return !settings || settings.dailyStepSync !== false;
}

/** 同一趟小程序会话回到前台会反复触发 onShow；5 分钟内不重复打同步接口 */
const DAILY_SYNC_KEY = 'werun_daily_synced_at';
const DAILY_SYNC_INTERVAL = 5 * 60 * 1000;

function syncedRecently() {
  try {
    return Date.now() - Number(wx.getStorageSync(DAILY_SYNC_KEY) || 0) < DAILY_SYNC_INTERVAL;
  } catch (e) {
    return false;
  }
}

function markSynced() {
  try {
    wx.setStorageSync(DAILY_SYNC_KEY, Date.now());
  } catch (e) {
    // 存不下只意味着可能多同步一次，不影响功能
  }
}

/**
 * 设置页开关开启时的「每日同步」：进小程序/回前台时静默跑一趟。
 * 未登录、开关关闭、5 分钟内已同步过 → 直接返回，不打扰。
 * 关闭后只有活动详情页（进行中且用到步数）会主动同步。
 */
async function syncDailySteps() {
  const app = getApp();
  if (!app || !app.globalData || !app.globalData.loggedIn) return { ok: false, reason: 'guest' };
  if (!isDailyStepSyncOn()) return { ok: false, reason: 'off' };
  if (syncedRecently()) return { ok: false, reason: 'throttled' };
  const r = await syncWeRunSteps();
  if (r.ok) markSynced();
  return r;
}

module.exports = {
  syncWeRunSteps,
  getWeRunAuthState,
  openWeRunSetting,
  isDailyStepSyncOn,
  syncDailySteps,
};

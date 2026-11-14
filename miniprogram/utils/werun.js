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

/**
 * 小程序是否在后台（app.onHide 置 false）。
 * 没有 App 实例（单测/非页面上下文）或标记缺失时一律按「在前台」处理，不阻断原有链路。
 */
function isAppHidden() {
  try {
    if (typeof getApp !== 'function') return false;
    const app = getApp();
    const visible = app && app.globalData ? app.globalData.appVisible : undefined;
    return visible === false;
  } catch (e) {
    return false; // getApp 不可用/App 未初始化：当作前台，不吞掉同步
  }
}

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
 *   reason: hidden / busy / privacy / privacy-denied / scope / denied / disabled / failed
 */
async function syncWeRunSteps({ requestAuth = false } = {}) {
  // 后台态不主动取步数（onHide 之后任何续跑的链路都在这里被拦下，不碰 login/取数）
  if (isAppHidden()) {
    if (isDebugEnv()) console.info('[werun] 阻断同步：小程序在后台（onHide 之后不发 login / 不取步数）');
    return { ok: false, reason: 'hidden' };
  }
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

/** 同一趟小程序会话回到前台会反复触发 onShow；10 分钟内不重复打同步接口（原 5 分钟，2026-11-14 调宽） */
const DAILY_SYNC_KEY = 'werun_daily_synced_at';
const DAILY_SYNC_INTERVAL = 10 * 60 * 1000;

function syncedRecently() {
  try {
    return Date.now() - Number(wx.getStorageSync(DAILY_SYNC_KEY) || 0) < DAILY_SYNC_INTERVAL;
  } catch (e) {
    return false;
  }
}

/**
 * 调试用状态快照（真机 vConsole 里能看到每次判定的依据）：
 * 前台与否、距上次同步多少分钟、阈值多少分钟。
 */
function debugState() {
  let last = 0;
  try {
    last = Number(wx.getStorageSync(DAILY_SYNC_KEY) || 0);
  } catch (e) {
    last = 0;
  }
  const intervalMin = Math.round(DAILY_SYNC_INTERVAL / 60000);
  const minutesAgo = last > 0 ? (Date.now() - last) / 60000 : -1;
  return {
    visible: !isAppHidden(),
    lastSyncAt: last,
    minutesAgo: Math.round(minutesAgo * 10) / 10,
    intervalMin,
  };
}

/**
 * 调试日志开关：只在开发版/真机调试打印（正式版静默，体验版也静默——
 * 需要看日志时用「真机调试」或开发版扫码即可）。2026-11-14 真机验证后收敛。
 */
function isDebugEnv() {
  try {
    const info = wx.getAccountInfoSync && wx.getAccountInfoSync();
    const env = info && info.miniProgram ? info.miniProgram.envVersion : '';
    if (!env) return true; // 拿不到环境信息（如 mock/测试）按开发态处理
    return env === 'develop';
  } catch (e) {
    return true;
  }
}

/** 日志序号：真机验证时用来区分「同一次切换被多个入口各判一次」和「两次切换」 */
let logSeq = 0;
/** 上一次决策日志的时间与内容（3 秒内同样内容不再重复打，避免 app.onShow + 页面 onShow 刷双行） */
let lastLog = { at: 0, reason: '', line: '' };

/** 一行式日志：时间戳 + 序号 + 判定依据（前缀统一 [werun]；仅开发版打印） */
function logDecision(action, reason, extra = '') {
  if (!isDebugEnv()) return;
  const st = debugState();
  const ago = st.minutesAgo < 0 ? '从未同步' : `距上次 ${st.minutesAgo} 分钟`;
  const ts = new Date().toTimeString().slice(0, 8);
  const line = `[werun] ${ts} #${logSeq + 1} ${action} reason=${reason} 前台=${st.visible} ${ago} 阈值=${st.intervalMin}分钟${extra}`;
  // 同一次前后台切换里，app.onShow 与页面 onShow 会先后各判一次：3 秒内同 reason 合并成一行
  if (reason === lastLog.reason && Date.now() - lastLog.at < 3000) {
    lastLog.at = Date.now();
    return;
  }
  logSeq += 1;
  lastLog = { at: Date.now(), reason, line };
  console.info(line);
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
 * 未登录、开关关闭、退到后台、10 分钟内已同步过 → 直接返回，不打扰。
 * 关闭后只有活动详情页（进行中且用到步数）会主动同步。
 */
async function syncDailySteps() {
  const app = getApp();
  if (!app || !app.globalData || !app.globalData.loggedIn) {
    logDecision('跳过每日同步', 'guest');
    return { ok: false, reason: 'guest' };
  }
  if (!isDailyStepSyncOn()) {
    logDecision('跳过每日同步', 'off');
    return { ok: false, reason: 'off' };
  }
  if (isAppHidden()) {
    logDecision('跳过每日同步', 'hidden');
    return { ok: false, reason: 'hidden' };
  }
  if (syncedRecently()) {
    logDecision('跳过每日同步', 'throttled');
    return { ok: false, reason: 'throttled' };
  }
  if (isDebugEnv()) console.info('[werun] 开始同步步数');
  const r = await syncWeRunSteps();
  if (r.ok) {
    markSynced();
    if (isDebugEnv()) console.info(`[werun] 同步完成：${r.syncedDays} 天`);
  } else {
    if (isDebugEnv()) console.info(`[werun] 同步结束未成功：reason=${r.reason}`, r.message || '');
  }
  return r;
}

module.exports = {
  syncWeRunSteps,
  isAppHidden,
  isDebugEnv,
  debugState,
  getWeRunAuthState,
  openWeRunSetting,
  isDailyStepSyncOn,
  syncDailySteps,
};

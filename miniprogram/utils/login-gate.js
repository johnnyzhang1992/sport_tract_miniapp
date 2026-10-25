/**
 * 写操作前置登录闸门（足迹两页共用）。
 *
 * app.login() 是纯静默 wx.login，任何游客点一下都能成功；弹窗不是授权步骤，只承担
 * 「让你知道要登录」——不在用户没主动操作时就给他建档（与 index/leaderboard/my 的既有取舍一致）。
 * 足迹各页文案必须一模一样，所以默认文案收在这里，别在页面里各写一份；
 * 非足迹页面（如积分页）可通过可选参数 content 传自己的触点文案，不传仍用足迹默认口径。
 */
function ensureLogin(content) {
  const app = getApp();
  if (app.globalData.loggedIn) return Promise.resolve(true);
  return new Promise((resolve) => {
    wx.showModal({
      title: '登录',
      content: content || '登录后才能记录你的足迹。',
      confirmText: '登录',
      cancelText: '暂不',
      success: (res) => {
        if (!res.confirm) return resolve(false);
        app
          .login()
          .then(() => resolve(true))
          .catch((e) => {
            wx.showToast({ title: (e && e.message) || '登录失败，请重试', icon: 'none' });
            resolve(false);
          });
      },
      // 弹窗开不出来 = 没拿到用户同意，按未登录处理，不能放行写操作
      fail: () => resolve(false),
    });
  });
}

/**
 * 等一次「已在飞行中的静默登录」，不新起登录。
 *
 * 冷启动直达子页（分享/小程序码/编译直达）时，app.onLaunch 的静默登录是个网络请求，
 * 页面 onLoad 早于它返回，直接读 globalData.loggedIn 会把老用户当游客、停在登录引导上
 * 且之后不再自查。这里只 join 那次已发起的恢复（onLaunch 才会调 login()），
 * 没有 in-flight 且未登录就是真游客，闸门行为不变。
 */
function waitSession() {
  const app = getApp();
  if (app.globalData.loggedIn) return Promise.resolve(true);
  const pending = app.globalData.loginPromise;
  if (!pending) return Promise.resolve(false);
  return pending.then(() => true).catch(() => false);
}

module.exports = { ensureLogin, waitSession };

/**
 * 写操作前置登录闸门（足迹两页共用）。
 *
 * app.login() 是纯静默 wx.login，任何游客点一下都能成功；弹窗不是授权步骤，只承担
 * 「让你知道要登录」——不在用户没主动操作时就给他建档（与 index/leaderboard/my 的既有取舍一致）。
 * 文案两页必须一模一样，所以收在这里，别在页面里各写一份。
 */
function ensureLogin() {
  const app = getApp();
  if (app.globalData.loggedIn) return Promise.resolve(true);
  return new Promise((resolve) => {
    wx.showModal({
      title: '登录',
      content: '登录后才能记录你的足迹。',
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

module.exports = { ensureLogin };

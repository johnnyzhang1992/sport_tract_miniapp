const { request } = require('./services/api');
const { getToken, setToken, clearToken } = require('./services/storage');

App({
  globalData: {
    userInfo: null,
    loggedIn: false,
    loginPromise: null,
  },

  onLaunch() {
    // 静默登录（决策 D2：微信一键登录无感）
    this.login();
  },

  onShow() {
    // 检测未保存的运动（保存失败/中途退出时数据在 storage，提供恢复入口）
    this.checkPendingSummary();
  },

  /** 有未保存运动 → 提示跳 summary 继续保存 */
  checkPendingSummary() {
    const pending = wx.getStorageSync('pending_summary');
    if (!pending || this._summaryPrompted) return;
    this._summaryPrompted = true;
    wx.showModal({
      title: '有未保存的运动',
      content: '上次运动尚未保存，是否现在保存？',
      confirmText: '去保存',
      cancelText: '忽略',
      success: (res) => {
        if (res.confirm) {
          wx.navigateTo({ url: '/pages/summary/summary' });
        }
      },
      complete: () => {
        // 短时间内避免重复弹窗
        setTimeout(() => {
          this._summaryPrompted = false;
        }, 8000);
      },
    });
  },

  /**
   * 静默登录：wx.login → 后端换 JWT → 存 token + 用户信息
   * 防重入：并发调用只发起一次
   */
  login() {
    if (!this.globalData.loginPromise) {
      this.globalData.loginPromise = this.doLogin().finally(() => {
        this.globalData.loginPromise = null;
      });
    }
    return this.globalData.loginPromise;
  },

  async doLogin() {
    const { code } = await wx.login();
    const data = await request({
      url: '/auth/login',
      method: 'POST',
      data: { code },
      skipAuth: true, // 登录接口自身无鉴权
    });
    setToken(data.accessToken, data.refreshToken);
    this.globalData.userInfo = data.user;
    this.globalData.loggedIn = true;
    return data.user;
  },

  /** 登出（token 失效时由 api.js 调用） */
  logout() {
    clearToken();
    this.globalData.userInfo = null;
    this.globalData.loggedIn = false;
  },
});

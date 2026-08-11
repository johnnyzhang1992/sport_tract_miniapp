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

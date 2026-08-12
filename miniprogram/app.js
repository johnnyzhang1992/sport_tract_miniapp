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
    // 隐私合规（决策 M5）：检查隐私协议状态，未同意时引导（微信后台已配置《用户隐私保护指引》）
    this.checkPrivacy();
  },

  /** 隐私合规：needAuthorization 时引导用户同意/查看协议 */
  checkPrivacy() {
    if (!wx.getPrivacySetting) return; // 基础库过低，跳过
    wx.getPrivacySetting({
      success: (res) => {
        // privacyContractName 有值时微信会自动弹协议；这里处理用户明确拒绝后的引导
        if (!res.needAuthorization) return;
        if (this._privacyPrompted) return;
        this._privacyPrompted = true;
        wx.showModal({
          title: '隐私保护提示',
          content: `为提供运动轨迹记录服务，我们需要使用您的位置信息（记录轨迹）、相册（上传打点照片）等。请阅读并同意《${res.privacyContractName || '用户隐私保护指引'}》。`,
          confirmText: '同意并继续',
          cancelText: '查看详情',
          success: (r) => {
            if (r.confirm) {
              // 同意：授权隐私接口（微信会自动弹正式协议，此处静默通过）
              if (wx.requirePrivacyAuthorize) {
                wx.requirePrivacyAuthorize({ fail: () => {} });
              }
            } else {
              // 拒绝/查看详情 → 跳转隐私政策页
              wx.navigateTo({ url: '/pages/privacy/privacy' });
            }
          },
        });
      },
    });
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

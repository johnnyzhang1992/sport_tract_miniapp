const api = require('./services/api');
const { request } = api;
const { getToken, setToken, clearToken, getProfileGuideDone, setProfileGuideDone } = require('./services/storage');

App({
  globalData: {
    userInfo: null,
    loggedIn: false,
    loginPromise: null,
    profileGuideAsked: false, // 完善资料引导本次会话是否已弹过
    api, // 网络层挂全局（分包页面无法 require 主包 JS，经 getApp() 访问）
  },

  onLaunch() {
    // 已注册用户（本地有 token）自动静默登录恢复会话；游客（无 token）不自动登录
    if (this.hasSession()) {
      this.login();
    }
    // 隐私合规（决策 M5）：检查隐私协议状态，未同意时引导（微信后台已配置《用户隐私保护指引》）
    this.checkPrivacy();
  },

  /** 本地是否有登录会话（已注册用户静默恢复的依据；游客无 token 视为未注册） */
  hasSession() {
    const token = getToken();
    return !!(token && (token.accessToken || token.refreshToken));
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
    // 收集设备信息用于登录日志（新 API 优先，兼容旧基础库）
    const device = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync();
    const base = wx.getAppBaseInfo ? wx.getAppBaseInfo() : wx.getSystemInfoSync();
    const accountInfo = wx.getAccountInfoSync();
    const data = await request({
      url: '/auth/login',
      method: 'POST',
      data: {
        code,
        platform: device.platform || 'weapp',
        system: `${device.system || ''} ${device.systemVersion || ''}`.trim(),
        brand: device.brand || '',
        model: device.model || '',
        sdkVersion: base.SDKVersion || '',
        appVersion: accountInfo.miniProgram.version || '',
      },
      skipAuth: true,
    });
    setToken(data.accessToken, data.refreshToken);
    this.globalData.userInfo = data.user;
    this.globalData.loggedIn = true;
    this.globalData.isNewUser = !!data.isNewUser; // 首次注册标记（引导完善资料用）
    return data.user;
  },

  /**
   * 引导完善资料（身高体重影响卡路里计算）
   * 弹出条件：资料已加载且不完整（缺体重或身高）+ 该用户未跳过/未完善 + 本次会话未弹过。
   * 不依赖 isNewUser（后端只在 openid 首次入库时为 true，老用户补登录永远不触发）。
   * 「跳过」按 userId 记 done，该用户不再弹；完善后下次检查自动落 done。
   * @returns {boolean} 是否弹出了引导（调用方可据此决定是否再 toast）
   */
  maybeShowProfileGuide() {
    const user = this.globalData.userInfo;
    if (!user) {
      console.debug('[guide] 不弹：userInfo 未加载');
      return false; // 资料未加载：不弹也不标 done（等下次登录/首页再试）
    }
    if (user.profileCompleted) {
      console.debug('[guide] 不弹：资料已完善（用户提交过身高/体重），落 done 标记');
      if (!getProfileGuideDone(user.id)) setProfileGuideDone(user.id);
      return false;
    }
    if (getProfileGuideDone(user.id)) {
      console.debug('[guide] 不弹：该用户已跳过/处理过', user.id);
      return false;
    }
    if (this.globalData.profileGuideAsked) {
      console.debug('[guide] 不弹：本次会话已弹过（首次触发点可能是首页静默登录后）');
      return false;
    }
    console.debug('[guide] 弹出完善资料引导, userId=', user.id);
    this.globalData.profileGuideAsked = true;
    wx.showModal({
      title: '完善资料',
      content: '设置身高和体重后，运动卡路里消耗的计算会更精准，还可以挑选头像、设置昵称～',
      confirmText: '去完善',
      cancelText: '跳过',
      success: (res) => {
        if (res.confirm) {
          wx.navigateTo({ url: '/pages/profile/profile?from=guide' });
        } else {
          setProfileGuideDone(user.id);
        }
      },
    });
    return true;
  },

  /** 登出（token 失效时由 api.js 调用） */
  logout() {
    clearToken();
    this.globalData.userInfo = null;
    this.globalData.loggedIn = false;
  },
});

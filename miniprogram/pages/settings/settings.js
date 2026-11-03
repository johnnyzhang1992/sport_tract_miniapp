/**
 * 设置页（决策 F25）
 * 单位切换（公制/英制）、默认运动类型、高精度定位开关 → PUT /users/me settings
 */
const api = require('../../services/api');
const storage = require('../../services/storage');
const { setAdFreeUntil } = require('../../utils/ad-free');
const config = require('../../config/index');

Page({
  data: {
    settings: {
      unit: 'metric',
      defaultType: 'walking',
      highAccuracy: true,
      showBodyData: true,
      kmAnnounce: true,
    },
    activityTypes: config.ACTIVITY_TYPES,
    saving: false,
    loggedIn: false, // 登录态（决定是否展示退出登录入口）
  },

  onLoad() {
    this.loadSettings();
    this.refreshEntitlements();
  },

  /**
   * 会员是免广告的第二条来源：设置页顺带刷一次缓存，付完会员回来广告组件才会收掉。
   * 拉不到就沿用上次缓存，不打扰用户（权益读取失败按非会员降级由服务端保证）。
   */
  refreshEntitlements() {
    const token = storage.getToken();
    if (!(token && token.accessToken)) return;
    api.get('/member/entitlements').then((e) => {
      if (e && e.adFreeUntil) setAdFreeUntil(e.adFreeUntil);
    }).catch(() => {});
  },

  /** 退出登录：清本地令牌回游客态（云端数据保留，重新登录可同步） */
  logout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后清空本地登录状态，你的运动数据仍保留在云端，重新登录即可同步回来。',
      confirmText: '退出',
      confirmColor: '#e34d59',
      success: (res) => {
        if (!res.confirm) return;
        getApp().logout();
        wx.showToast({ title: '已退出登录', icon: 'success' });
        setTimeout(() => wx.switchTab({ url: '/pages/my/my' }), 600);
      },
    });
  },

  async loadSettings() {
    try {
      const user = await api.get('/users/me');
      this.setData({
        loggedIn: true, // 能拉到资料即已登录（游客态接口 401）
        settings: Object.assign(
          { unit: 'metric', defaultType: 'walking', highAccuracy: true, showBodyData: true, kmAnnounce: true },
          user.settings,
        ),
      });
    } catch (e) {
      console.error('加载设置失败', e);
      this.setData({ loggedIn: false });
    }
  },

  onDefaultTypeChange(e) {
    this.setData({ 'settings.defaultType': e.currentTarget.dataset.type });
  },

  onHighAccuracyChange(e) {
    this.setData({ 'settings.highAccuracy': e.detail.value });
  },

  onShowBodyDataChange(e) {
    this.setData({ 'settings.showBodyData': e.detail.value });
  },

  onKmAnnounceChange(e) {
    this.setData({ 'settings.kmAnnounce': e.detail.value });
  },

  /** 打开隐私政策 */
  openPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  async save() {
    if (this.data.saving) return;
    this.setData({ saving: true });
    try {
      const saved = await api.put('/users/me', { settings: this.data.settings });
      wx.showToast({ title: '已保存', icon: 'success' });
      // 同步全局（my 页身高体重展示开关即时生效）
      const app = getApp();
      if (app.globalData.userInfo) {
        app.globalData.userInfo.settings = saved.settings || this.data.settings;
      }
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' });
      console.error(e);
    } finally {
      this.setData({ saving: false });
    }
  },
});

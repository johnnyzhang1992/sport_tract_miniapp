const api = require('../../services/api');

Page({
  data: {
    user: null,
    loggedIn: false,
    loading: false,
  },

  onShow() {
    this.refreshUser();
  },

  onPullDownRefresh() {
    this.refreshUser().finally(() => wx.stopPullDownRefresh());
  },

  async refreshUser() {
    const app = getApp();
    try {
      if (!app.globalData.loggedIn) {
        await app.login();
      }
      this.setData({ loading: true });
      // 刷新资料（PUT/GET /users/me 已实现）
      const user = await api.get('/users/me');
      // WXML 不支持字符串下标，预处理好头像首字
      this.setData({ user: { ...user, avatarText: user.nickname ? user.nickname[0] : '' }, loggedIn: true });
    } catch (e) {
      console.error('加载用户信息失败', e);
    } finally {
      this.setData({ loading: false });
    }
  },

  /** 轨迹合集（M6：一周/一月/一年一图总览） */
  goOverview() {
    wx.navigateTo({ url: '/pages/overview/overview' });
  },

  goStats() {
    wx.navigateTo({ url: '/pages/stats/stats' });
  },

  goSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' });
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' });
  },
});

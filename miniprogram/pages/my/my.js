const api = require('../../services/api');

Page({
  data: {
    user: null,
    loggedIn: false,
    loading: false,
    overview: null, // { totalCount, totalKm }
    footprint: null, // { provinceCount, cityCount }
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
      // 刷新资料 + 概况（轨迹合集总数/点亮省市数）
      const [user, overview, footprint] = await Promise.all([
        api.get('/users/me'),
        api.get('/stats/overview').catch(() => null),
        api.get('/stats/footprint').catch(() => null),
      ]);
      const total = overview && overview.total ? overview.total : { count: 0, distance: 0 };
      // WXML 不支持字符串下标，预处理好头像首字
      this.setData({
        user: { ...user, avatarText: user.nickname ? user.nickname[0] : '' },
        loggedIn: true,
        overview: {
          totalCount: total.count || 0,
          totalKm: ((total.distance || 0) / 1000).toFixed(1),
        },
        footprint: {
          provinceCount: footprint ? footprint.provinceCount : 0,
          cityCount: footprint ? footprint.cityCount : 0,
        },
      });
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

  /** 数据导入（M7：两步路/Strava 等 GPX/KML/TCX） */
  goImport() {
    wx.navigateTo({ url: '/pages/import/import' });
  },

  /** 点亮地图（足迹省份/城市统计） */
  goFootprint() {
    wx.navigateTo({ url: '/packageFootprint/pages/footprint/footprint' });
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

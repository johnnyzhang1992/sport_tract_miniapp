const config = require('../../config/index');
const api = require('../../services/api');

Page({
  data: {
    activityTypes: config.ACTIVITY_TYPES,
    selectedType: 'running',
    overview: null,
    loading: false,
  },

  onShow() {
    this.loadOverview();
  },

  onPullDownRefresh() {
    this.loadOverview().finally(() => wx.stopPullDownRefresh());
  },

  selectType(e) {
    this.setData({ selectedType: e.currentTarget.dataset.type });
  },

  /** 今日/本周概览（决策 F18） */
  async loadOverview() {
    try {
      const app = getApp();
      if (!app.globalData.loggedIn) {
        await app.login();
      }
      this.setData({ loading: true });
      const overview = await api.get('/stats/overview');
      // 预处理：WXML 不支持 toFixed 等方法调用
      this.setData({
        overview: {
          today: {
            count: overview.today.count,
            distanceKm: (overview.today.distance / 1000).toFixed(2),
            durationMin: Math.round(overview.today.duration / 60),
            calories: overview.today.calories,
          },
        },
      });
    } catch (e) {
      console.error('加载概览失败', e);
    } finally {
      this.setData({ loading: false });
    }
  },

  /** 开始运动 → 记录页（M2 里程碑：实时地图+数据面板） */
  startRecord() {
    wx.navigateTo({
      url: `/pages/record/record?type=${this.data.selectedType}`,
    });
  },

  /** 轨迹合集（M6）：一周/一月/一年一图总览 */
  openOverview() {
    wx.navigateTo({ url: '/pages/overview/overview' });
  },
});

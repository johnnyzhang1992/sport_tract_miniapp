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
      this.setData({ overview });
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
});

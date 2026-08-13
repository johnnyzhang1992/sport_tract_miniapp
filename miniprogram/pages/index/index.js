const config = require('../../config/index');
const api = require('../../services/api');

Page({
  data: {
    activityTypes: config.ACTIVITY_TYPES,
    selectedType: 'running',
    overview: null,
    overviewLabel: '今日概览',
    loading: false,
  },

  onShow() {
    this.applyDefaultType();
    this.loadOverview();
  },

  /** 应用设置的默认运动类型（设置页保存到后端用户 settings） */
  async applyDefaultType() {
    try {
      const app = getApp();
      // 确保已登录（onShow 时可能登录尚未完成，导致读取不到 settings）
      if (!app.globalData.loggedIn) {
        await app.login();
      }
      const user = await api.get('/users/me');
      const dt = user && user.settings && user.settings.defaultType;
      if (dt && config.ACTIVITY_TYPES.some((t) => t.type === dt)) {
        this.setData({ selectedType: dt });
      }
    } catch (e) {
      console.error('读取默认运动类型失败', e);
    }
  },

  onPullDownRefresh() {
    this.loadOverview().finally(() => wx.stopPullDownRefresh());
  },

  selectType(e) {
    this.setData({ selectedType: e.currentTarget.dataset.type });
  },

  /** 今日/本周/当月/今年概览（决策 F18）——请求去重 + 失败保留旧数据（切换 tab 不丢） */
  async loadOverview() {
    if (this._loadingOverview) return; // 进行中不重复请求（tab 快速切换竞态）
    this._loadingOverview = true;
    try {
      const app = getApp();
      if (!app.globalData.loggedIn) {
        await app.login();
      }
      const overview = await api.get('/stats/overview');
      // 兜底优先级：今日 → 本周 → 当月 → 今年 → 今日（都无数据）
      const order = [
        { key: 'today', label: '今日' },
        { key: 'week', label: '本周' },
        { key: 'month', label: '当月' },
        { key: 'year', label: '今年' },
      ];
      const sec =
        order.find((o) => (overview[o.key] || {}).count > 0) ||
        { key: 'today', label: '今日' };
      const s = overview[sec.key] || { count: 0, distance: 0, duration: 0, calories: 0 };
      // 预处理：WXML 不支持 toFixed 等方法调用
      this.setData({
        overviewLabel: sec.label + '概览',
        overview: {
          today: {
            count: s.count,
            distanceKm: (s.distance / 1000).toFixed(2),
            durationMin: Math.round(s.duration / 60),
            calories: s.calories,
          },
        },
      });
    } catch (e) {
      console.error('加载概览失败', e); // 保留旧数据（不置空，避免切换 tab 后空白）
    } finally {
      this._loadingOverview = false;
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

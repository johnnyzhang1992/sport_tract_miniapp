/**
 * 设置页（决策 F25）
 * 单位切换（公制/英制）、默认运动类型、高精度定位开关 → PUT /users/me settings
 */
const api = require('../../services/api');
const config = require('../../config/index');

Page({
  data: {
    settings: {
      unit: 'metric',
      defaultType: 'walking',
      highAccuracy: true,
      showBodyData: true,
    },
    activityTypes: config.ACTIVITY_TYPES,
    saving: false,
  },

  onLoad() {
    this.loadSettings();
  },

  async loadSettings() {
    try {
      const user = await api.get('/users/me');
      this.setData({
        settings: Object.assign(
          { unit: 'metric', defaultType: 'walking', highAccuracy: true, showBodyData: true },
          user.settings,
        ),
      });
    } catch (e) {
      console.error('加载设置失败', e);
    }
  },

  onUnitChange(e) {
    this.setData({ 'settings.unit': e.currentTarget.dataset.value });
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

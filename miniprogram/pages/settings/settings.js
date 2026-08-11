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
        settings: Object.assign({ unit: 'metric', defaultType: 'walking', highAccuracy: true }, user.settings),
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

  async save() {
    if (this.data.saving) return;
    this.setData({ saving: true });
    try {
      await api.put('/users/me', { settings: this.data.settings });
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' });
      console.error(e);
    } finally {
      this.setData({ saving: false });
    }
  },
});

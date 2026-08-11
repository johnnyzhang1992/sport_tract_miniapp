const api = require('../../services/api');
const config = require('../../config/index');
const storage = require('../../services/storage');
const { formatDuration, formatPace } = require('../../utils/format');

Page({
  data: {
    id: '',
    activity: null,
    markers: [],
    loading: true,
  },

  onLoad(options) {
    this.setData({ id: options.id });
    this.loadDetail();
  },

  async loadDetail() {
    try {
      this.setData({ loading: true });
      const activity = await api.get(`/activities/${this.data.id}`);
      const meta = config.ACTIVITY_TYPES.find((t) => t.type === activity.type) || {};
      const markers = (activity.markers || []).map((m) => ({
        ...m,
        typeMeta: config.MARKER_TYPES.find((t) => t.type === m.type) || {},
        timeText: new Date(m.timestamp).toLocaleString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      }));
      this.setData({
        activity: {
          ...activity,
          icon: meta.icon || '🏃',
          label: meta.label || activity.type,
          distanceKm: (activity.distance / 1000).toFixed(2),
          durationText: formatDuration(activity.duration),
          paceText: formatPace(activity.avgPace),
        },
        markers,
      });
    } catch (e) {
      wx.showToast({ title: '加载详情失败', icon: 'none' });
      console.error(e);
    } finally {
      this.setData({ loading: false });
    }
  },

  /** 导出 GPX（已实现） */
  exportGpx() {
    const token = storage.getToken();
    wx.showLoading({ title: '生成中…' });
    wx.request({
      url: config.API_BASE_URL + `/activities/${this.data.id}/gpx`,
      method: 'GET',
      header: { Authorization: `Bearer ${(token && token.accessToken) || ''}` },
      success: (res) => {
        wx.hideLoading();
        if (res.statusCode === 200) {
          wx.showModal({
            title: 'GPX 导出',
            content: String(res.data).slice(0, 200),
            showCancel: false,
          });
        } else {
          wx.showToast({ title: '导出失败', icon: 'none' });
        }
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '导出失败', icon: 'none' });
      },
    });
  },
});

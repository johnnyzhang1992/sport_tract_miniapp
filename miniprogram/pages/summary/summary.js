/**
 * 运动摘要页（文档 3.3）
 * 数据：record 页暂存到 storage（pending_summary / pending_sync_activity）
 * 保存：提交 finish final 包（服务端对账）→ 跳轨迹列表
 * 放弃：取消活动 → 回首页
 */
const config = require('../../config/index');
const loading = require('../../utils/loading');
const { SyncService } = require('../../services/sync');
const { formatDuration, formatPace } = require('../../utils/format');

Page({
  data: {
    typeLabel: '',
    typeIcon: '🏃',
    typeIconImg: '',
    stats: null,
    mapPoints: [],
    markers: [],
    loading: true,
    saving: false,
  },

  onLoad() {
    const pending = wx.getStorageSync('pending_summary');
    if (!pending) {
      wx.showToast({ title: '没有待保存的运动', icon: 'none' });
      setTimeout(() => wx.switchTab({ url: '/pages/index/index' }), 1200);
      return;
    }

    const { finalPack, stats, typeLabel, typeIcon, typeIconImg } = pending;
    const meta = config.MARKER_TYPES;

    this.finalPack = finalPack;
    this.sync = new SyncService();
    this.sync.activityId = wx.getStorageSync('pending_sync_activity');

    this.setData({
      typeLabel,
      typeIcon,
      typeIconImg,
      stats: {
        distanceKm: (stats.distance / 1000).toFixed(2),
        durationText: formatDuration(stats.durationSec),
        paceText: stats.pace ? formatPace(stats.pace) : '—',
        calories: stats.calories,
        elevationGain: stats.elevationGain,
        maxAltitude: stats.maxAltitude,
        markerCount: (finalPack.markers || []).length,
      },
      mapPoints: (finalPack.trackPoints || []).map((p) => ({
        lat: p.lat,
        lng: p.lng,
        pauseGap: !!p.pauseGap,
      })),
      markers: (finalPack.markers || []).map((m) => ({
        id: m.id,
        lat: m.lat,
        lng: m.lng,
        typeMeta: meta.find((t) => t.type === m.type) || {},
        note: m.note,
        timeText: new Date(m.timestamp).toLocaleString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      })),
      loading: false,
    });
  },

  /** 保存：提交 finish 对账 → 清暂存 → 跳轨迹列表 */
  async save() {
    if (this.data.saving) return;
    this.setData({ saving: true });
    loading.show('保存中…');
    try {
      // 清洗 final 包：负 speed（微信异常值）→ null，负 pausedMs → 0（兜底历史数据）
      const pack = this.finalPack;
      const cleanPack = {
        ...pack,
        trackPoints: (pack.trackPoints || []).map((p) => ({
          ...p,
          speed: p.speed != null && p.speed < 0 ? null : p.speed,
        })),
        pausedMs: pack.pausedMs != null && pack.pausedMs < 0 ? 0 : pack.pausedMs,
      };
      await this.sync.finish(cleanPack);
      loading.hide();
      wx.removeStorageSync('pending_summary');
      wx.removeStorageSync('pending_sync_activity');
      wx.removeStorageSync('ongoingActivity');
      wx.showToast({ title: '已保存', icon: 'success' });
      // 轨迹列表 tab 页无法带参：打标记让 onShow 重新拉取最新数据
      getApp().globalData.tracksNeedRefresh = true;
      setTimeout(() => wx.switchTab({ url: '/pages/tracks/tracks' }), 600);
    } catch (e) {
      loading.hide();
      this.setData({ saving: false });
      // 409：活动已结束/被服务端作废（如 24h 惰性清理）→ 无法保存，清现场回首页
      if (e.statusCode === 409) {
        wx.removeStorageSync('pending_summary');
        wx.removeStorageSync('pending_sync_activity');
        wx.removeStorageSync('ongoingActivity');
        wx.showModal({
          title: '运动已失效',
          content: '该运动在服务端已超时结束，无法保存',
          showCancel: false,
          success: () => wx.switchTab({ url: '/pages/index/index' }),
        });
        console.warn('[summary] 活动已失效（409），已清空现场', e);
        return;
      }
      wx.showModal({
        title: '保存失败',
        content: e.message || '网络异常，请重试',
        showCancel: false,
      });
      console.error('[summary] 保存失败', e);
    }
  },

  /** 放弃：取消活动 → 回首页 */
  discard() {
    wx.showModal({
      title: '放弃本次运动？',
      content: '该次运动将不会保存',
      confirmText: '放弃',
      confirmColor: '#ff4d4f',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await this.sync.cancel();
        } catch {
          // 静默
        }
        wx.removeStorageSync('pending_summary');
        wx.removeStorageSync('pending_sync_activity');
        wx.removeStorageSync('ongoingActivity');
        wx.switchTab({ url: '/pages/index/index' });
      },
    });
  },
});

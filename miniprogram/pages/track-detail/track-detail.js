/**
 * 轨迹详情页（M3）
 * - 地图：完整 polyline + 打点 markers + 图层切换 + 轨迹回放
 * - 指标卡片 + 打点时间线（点击打点可编辑/删除/补打点）
 * 后端接口：GET /activities/:id、PUT/DELETE /markers/:markerId、POST /markers
 */
const api = require('../../services/api');
const config = require('../../config/index');
const storage = require('../../services/storage');
const { uploadPhoto } = require('../../services/oss-upload');
const { formatDuration, formatPace } = require('../../utils/format');

Page({
  data: {
    id: '',
    activity: null,
    mapPoints: [],
    markers: [], // 打点 markers（地图）
    markerList: [], // 打点时间线（带展示字段）
    mapType: 'standard',
    loading: true,
    replaying: false,

    // 打点弹窗（编辑/新增）
    markerFormVisible: false,
    editMode: false,
    editMarker: null,
    markerBusy: false,
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

      this.activity = activity; // 保留原始数据（回放用）

      // 海拔曲线数据（抽稀到 ≤ 60 点，只有有效海拔才展示）
      const altPts = (activity.trackPoints || []).filter((p) => p.altitude != null);
      const step = Math.max(1, Math.ceil(altPts.length / 60));
      const altitudeChart = altPts
        .filter((_, i) => i % step === 0)
        .map((p, i) => ({ label: String(i), value: p.altitude }));

      this.setData({
        activity: {
          ...activity,
          icon: meta.icon || '🏃',
          label: meta.label || activity.type,
          distanceKm: (activity.distance / 1000).toFixed(2),
          durationText: formatDuration(activity.duration),
          paceText: formatPace(activity.avgPace),
        },
        mapPoints: (activity.trackPoints || []).map((p) => ({ lat: p.lat, lng: p.lng })),
        markers: (activity.markers || []).map((m) => ({ id: m.id, lat: m.lat, lng: m.lng })),
        markerList: (activity.markers || []).map((m) => ({
          ...m,
          typeMeta: config.MARKER_TYPES.find((t) => t.type === m.type) || {},
          timeText: new Date(m.timestamp).toLocaleString('zh-CN', {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }),
        })),
        altitudeChart,
      });
    } catch (e) {
      wx.showToast({ title: '加载详情失败', icon: 'none' });
      console.error(e);
    } finally {
      this.setData({ loading: false });
    }
  },

  // ==================== 地图 ====================

  switchLayer() {
    const map = this.selectComponent('#detailMap');
    if (map && typeof map.switchLayer === 'function') {
      map.switchLayer();
    }
    this.setData({ mapType: this.data.mapType === 'standard' ? 'satellite' : 'standard' });
  },

  // ==================== 轨迹回放 ====================

  startReplay() {
    if (this.data.replaying) {
      this.stopReplay();
      return;
    }
    const pts = (this.activity && this.activity.trackPoints) || [];
    if (pts.length < 2) {
      wx.showToast({ title: '轨迹点太少，无法回放', icon: 'none' });
      return;
    }
    const map = this.selectComponent('#detailMap');
    if (!map || typeof map.startReplay !== 'function') return;
    this.setData({ replaying: true });
    map.startReplay(
      pts.map((p) => ({ lat: p.lat, lng: p.lng })),
      { speedMps: 10, onEnd: () => this.setData({ replaying: false }) },
    );
  },

  stopReplay() {
    const map = this.selectComponent('#detailMap');
    if (map && typeof map.stopReplay === 'function') map.stopReplay();
    this.setData({ replaying: false });
  },

  onReplayEnd() {
    this.setData({ replaying: false });
    wx.showToast({ title: '回放完成', icon: 'success' });
  },

  // ==================== 打点编辑/删除/补点 ====================

  onMarkerTap(e) {
    const markerId = e.detail; // track-map 返回数字 id，需映射回打点
    // 用坐标匹配（track-map 数字 id 与打点顺序一致）
    const idx = (typeof markerId === 'number' ? markerId - 1 : -1);
    const list = this.data.markerList;
    if (idx >= 0 && idx < list.length) {
      this.openEditMarker(list[idx]);
    }
  },

  /** 点击打点时间线 → 编辑 */
  onTapMarkerItem(e) {
    this.openEditMarker(e.currentTarget.dataset.marker);
  },

  openEditMarker(marker) {
    this.setData({
      markerFormVisible: true,
      editMode: true,
      editMarker: marker,
    });
  },

  /** 新增打点（补打） */
  addMarker() {
    this.setData({
      markerFormVisible: true,
      editMode: false,
      editMarker: null,
    });
  },

  async onMarkerConfirm(e) {
    const { markerId, type, note, photoTempFile } = e.detail;
    if (this.data.markerBusy) return;
    this.setData({ markerBusy: true });

    wx.showLoading({ title: '保存中…' });
    try {
      // 照片直传（合规检测已内置；编辑模式通常不带新照片）
      let photoUrl = '';
      if (photoTempFile) {
        const up = await uploadPhoto(photoTempFile);
        if (up && up.blocked) {
          wx.hideLoading();
          wx.showToast({ title: '图片包含不当内容', icon: 'none' });
          return;
        }
        photoUrl = up ? up.url : '';
      }

      if (markerId) {
        // 编辑：仅更新传入字段
        const body = { type, note };
        if (photoUrl) body.photoUrl = photoUrl;
        await api.put(`/activities/${this.data.id}/markers/${markerId}`, body);
      } else {
        // 补打点：坐标用最后一个轨迹点（或地图中心）
        const pts = (this.activity && this.activity.trackPoints) || [];
        const last = pts[pts.length - 1];
        const loc = last
          ? { lat: last.lat, lng: last.lng }
          : { lat: 0, lng: 0 };
        await api.post(`/activities/${this.data.id}/markers`, {
          id: `m_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
          lat: loc.lat,
          lng: loc.lng,
          timestamp: Date.now(),
          type,
          note,
          photoUrl,
        });
      }

      wx.hideLoading();
      wx.showToast({ title: markerId ? '已更新' : '已添加', icon: 'success' });
      this.setData({ markerFormVisible: false });
      await this.loadDetail();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '保存失败', icon: 'none' });
      console.error(err);
    } finally {
      this.setData({ markerBusy: false });
    }
  },

  onMarkerDelete(e) {
    const { markerId } = e.detail;
    wx.showModal({
      title: '删除该打点？',
      confirmText: '删除',
      confirmColor: '#ff4d4f',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.del(`/activities/${this.data.id}/markers/${markerId}`);
          wx.showToast({ title: '已删除', icon: 'success' });
          this.setData({ markerFormVisible: false });
          await this.loadDetail();
        } catch (err) {
          wx.showToast({ title: '删除失败', icon: 'none' });
          console.error(err);
        }
      },
    });
  },

  onMarkerCancel() {
    this.setData({ markerFormVisible: false });
  },

  /** 导出 GPX */
  exportGpx() {
    const token = storage.getToken();
    wx.showLoading({ title: '生成中…' });
    wx.request({
      url: config.API_BASE_URL + '/api' + `/activities/${this.data.id}/gpx`,
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

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
const { formatDuration, formatPace, formatPaceParts } = require('../../utils/format');

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
    fullscreen: false,

    // 单段明细（每公里）
    kmSegs: [],
    displaySegs: [], // 默认前 10 段
    segsVisible: false,
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


      const fmtTime = (ts) => {
        const d = new Date(ts);
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
      };
      // 平均精度（轨迹点 accuracy 均值；旧数据无 accuracy 时跳过）
      const accs = (activity.trackPoints || [])
        .map((p) => p.accuracy)
        .filter((a) => typeof a === 'number' && a > 0);
      const avgAccuracy = accs.length > 0 ? Math.round(accs.reduce((s, a) => s + a, 0) / accs.length) : null;
      const endTime = activity.endTime || activity.startTime + (activity.duration || 0) * 1000;
      this.setData({
        activity: {
          ...activity,
          icon: meta.icon || '🏃',
          label: meta.label || activity.type,
          distanceKm: (activity.distance / 1000).toFixed(2),
          durationText: formatDuration(activity.duration),
          paceValue: (formatPaceParts(activity.avgPace) || {}).value || '—',
          paceUnit: (formatPaceParts(activity.avgPace) || {}).unit || '',
          startTimeText: fmtTime(activity.startTime),
          endTimeText: fmtTime(endTime),
          avgAccuracy,
        },
        mapPoints: (activity.trackPoints || []).map((p) => ({
          lat: p.lat,
          lng: p.lng,
          altitude: p.altitude != null ? p.altitude : null,
        })),
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
      // 单段明细（每公里分段；默认展示前 10）
      const segs = this.computeKmSegments(activity.trackPoints || []);
      this.setData({ kmSegs: segs, displaySegs: segs.slice(0, 10) });
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
    const { markerId, type, note, photos, existingPhotos } = e.detail;
    if (this.data.markerBusy) return;
    this.setData({ markerBusy: true });

    wx.showLoading({ title: '保存中…' });
    try {
      // 新图直传（合规检测内置；违规中止）
      const urls = [];
      if (photos && photos.length) {
        for (const f of photos) {
          const up = await uploadPhoto(f);
          if (up && up.blocked) {
            wx.hideLoading();
            wx.showToast({ title: '图片包含不当内容', icon: 'none' });
            return;
          }
          if (up && up.url) urls.push(up.url);
        }
      }

      if (markerId) {
        // 编辑：保留已有照片（含删除后剩余）+ 新上传 → photos 全量替换
        const finalPhotos = (existingPhotos || []).concat(urls).slice(0, 3);
        await api.put(`/activities/${this.data.id}/markers/${markerId}`, {
          type,
          note,
          photos: finalPhotos,
        });
      } else {
        // 补打点：坐标用最后一个轨迹点
        const pts = (this.activity && this.activity.trackPoints) || [];
        const last = pts[pts.length - 1];
        const loc = last ? { lat: last.lat, lng: last.lng } : { lat: 0, lng: 0 };
        await api.post(`/activities/${this.data.id}/markers`, {
          id: `m_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
          lat: loc.lat,
          lng: loc.lng,
          timestamp: Date.now(),
          type,
          note,
          photoUrl: urls[0] || '',
          photos: urls,
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

  /** 分享海报 */
  sharePoster() {
    const card = this.selectComponent('#shareCard');
    if (card && typeof card.preview === 'function') {
      card.preview();
    } else {
      wx.showToast({ title: '组件未就绪', icon: 'none' });
    }
  },

  /** 单段明细：按每公里切分段（序号/时间/配速），最后不足 1km 记为余段 */
  computeKmSegments(points) {
    if (!points || points.length < 2) return [];
    const toRad = (d) => (d * Math.PI) / 180;
    const distM = (a, b) => {
      const R = 6371000;
      const dLat = toRad(b.lat - a.lat);
      const dLng = toRad(b.lng - a.lng);
      const s =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(s));
    };
    const segs = [];
    let cur = { startTs: points[0].timestamp, acc: 0 };
    for (let i = 1; i < points.length; i++) {
      const d = distM(points[i - 1], points[i]);
      cur.acc += d;
      if (cur.acc >= 1000) {
        const durationSec = Math.max(1, Math.round((points[i].timestamp - cur.startTs) / 1000));
        const distKm = cur.acc / 1000;
        segs.push({
          idx: segs.length + 1,
          distKm,
          durationSec,
          durationText: formatDuration(durationSec),
          paceText: formatPace(durationSec / distKm),
        });
        cur = { startTs: points[i].timestamp, acc: 0 };
      }
    }
    // 最后不足 1km 的余段（位移 >20m 才展示）
    if (cur.acc > 20 && points.length >= 2) {
      const last = points[points.length - 1];
      const durationSec = Math.max(1, Math.round((last.timestamp - cur.startTs) / 1000));
      const distKm = cur.acc / 1000;
      segs.push({
        idx: segs.length + 1,
        distKm,
        durationSec,
        durationText: formatDuration(durationSec),
        paceText: formatPace(durationSec / distKm),
        partial: true, // 余段（不足 1km）
      });
    }
    return segs;
  },

  /** 查看全部单段（弹窗） */
  openAllSegs() {
    this.setData({ segsVisible: true });
  },

  onSegsVisibleChange(e) {
    if (!e.detail.visible) this.setData({ segsVisible: false });
  },

  /** 打开编辑面板 */
  openEdit() {
    const act = this.data.activity || {};
    this.setData({
      editVisible: true,
      editType: act.type || '',
      editNote: act.note || '',
    });
  },

  onEditVisibleChange(e) {
    if (!e.detail.visible) {
      this.setData({ editVisible: false });
    }
  },

  onEditTypeChange(e) {
    this.setData({ editType: e.currentTarget.dataset.type });
  },

  onEditNoteInput(e) {
    this.setData({ editNote: e.detail.value });
  },

  /** 保存编辑（改类型重算配速/卡路里；备注 ≤500） */
  async saveEdit() {
    if (this.data.editSaving) return;
    const { editType, editNote } = this.data;
    const body = {};
    if (editType && editType !== (this.data.activity || {}).type) body.type = editType;
    if (editNote !== ((this.data.activity || {}).note || '')) body.note = editNote;
    if (Object.keys(body).length === 0) {
      this.setData({ editVisible: false });
      return;
    }
    this.setData({ editSaving: true });
    try {
      const res = await api.put(`/activities/${this.data.id}/meta`, body);
      // 刷新类型/备注（指标不变，仅更新展示字段）
      const act = this.data.activity || {};
      const meta = config.ACTIVITY_TYPES.find((t) => t.type === res.type) || {};
      this.setData({
        'activity.type': res.type,
        'activity.label': meta.label || res.type,
        'activity.icon': meta.icon || '🏃',
        'activity.note': res.note,
        editVisible: false,
      });
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (e) {
      console.error('保存编辑失败', e);
      wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      this.setData({ editSaving: false });
    }
  },


  /** 海报生成完成：记录路径（分享卡片/朋友圈封面） */
  onPosterReady(e) {
    this.shareImagePath = e.detail.path;
  },

  /** 分享给朋友（海报作为卡片封面） */
  onShareAppMessage() {
    const act = this.data.activity || {};
    return {
      title: `我的${act.label || '运动'}轨迹 · ${act.distanceKm || ''}公里`,
      path: `/pages/track-detail/track-detail?id=${this.data.id}`,
      imageUrl: this.shareImagePath || '',
    };
  },

  /** 分享到朋友圈（右上角菜单，海报作封面） */
  onShareTimeline() {
    const act = this.data.activity || {};
    return {
      title: `我的${act.label || '运动'}轨迹 · ${act.distanceKm || ''}公里`,
      query: `id=${this.data.id}`,
      imageUrl: this.shareImagePath || '',
    };
  },

  /** 全屏展示地图 */
  openFullscreen() {
    this.setData({ fullscreen: true });
  },

  closeFullscreen() {
    this.setData({ fullscreen: false });
  },

  /** 全屏地图图层切换（与页面 mapType 同步） */
  fsSwitchLayer() {
    this.setData({ mapType: this.data.mapType === 'standard' ? 'satellite' : 'standard' });
    const map = this.selectComponent('#fullscreenMap');
    if (map && typeof map.switchLayer === 'function') map.switchLayer();
  },

  noop() {},

  /** 重新纠偏：对轨迹重跑 清洗→纠偏→平滑→重算指标（清理历史脏数据） */
  async reprocessTrack() {
    const res = await new Promise((resolve) => {
      wx.showModal({
        title: '重新纠偏',
        content: '将重新清洗轨迹（剔除 GPS 偏移点）并重算距离/配速等指标，是否继续？',
        confirmText: '纠偏',
        success: resolve,
        fail: () => resolve({ confirm: false }),
      });
    });
    if (!res.confirm) return;
    wx.showLoading({ title: '纠偏中…' });
    try {
      const data = await api.post(`/activities/${this.data.id}/reprocess`);
      this.loadDetail();
      wx.showToast({ title: '纠偏完成', icon: 'success' });
    } catch (e) {
      console.error('纠偏失败', e);
      wx.showToast({ title: '纠偏失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
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
          const plat =
            (wx.getDeviceInfo ? wx.getDeviceInfo().platform : wx.getSystemInfoSync().platform || '').toLowerCase();
          // devtools（开发者工具）：直接复制剪贴板（工具内分享不可用，复制便于粘贴分析）
          if (plat === 'devtools') {
            wx.setClipboardData({
              data: String(res.data),
              success: () => {
                wx.showModal({
                  title: 'GPX 已复制',
                  content: '轨迹数据已复制到剪贴板（devtools 调试用）',
                  showCancel: false,
                });
              },
              fail: () => wx.showToast({ title: '复制失败', icon: 'none' }),
            });
            return;
          }
          // PC 微信（windows/mac）与手机端：保存 .gpx 文件并分享（文件传输助手 → 电脑下载）
          const fs = wx.getFileSystemManager();
          const path = `${wx.env.USER_DATA_PATH}/activity-${this.data.id}.gpx`;
          try {
            fs.writeFileSync(path, String(res.data), 'utf8');
          } catch (e) {
            wx.showToast({ title: '写入失败', icon: 'none' });
            return;
          }
          wx.shareFileMessage({
            filePath: path,
            fileName: `activity-${this.data.id}.gpx`,
            success: () => {},
            fail: () => {
              wx.showModal({
                title: '导出失败',
                content: '无法调起分享，请将文件保存到手机后通过文件传输助手发送',
                showCancel: false,
              });
            },
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

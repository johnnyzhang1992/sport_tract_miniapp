/**
 * 轨迹详情页（M3）
 * - 地图：完整 polyline + 打点 markers + 图层切换 + 轨迹回放
 * - 指标卡片 + 打点时间线（点击打点可编辑/删除）
 * 后端接口：GET /activities/:id、PUT/DELETE /markers/:markerId、POST /markers
 */
const api = require('../../services/api');
const loading = require('../../utils/loading');
const config = require('../../config/index');
const { getBestCache, setBestCache } = require('../../services/storage');
const storage = require('../../services/storage');
const { uploadPhoto } = require('../../services/oss-upload');
const { formatDuration, formatPaceParts } = require('../../utils/format');
const { getPaceScale } = require('../../utils/pace-scale');
const { computeRunPaceZones } = require('../../utils/track-pace');
const { buildAltitudeChart, usesAltitudeColor } = require('../../utils/track-altitude');

Page({
  data: {
    id: '',
    activity: null,
    activityTypes: config.ACTIVITY_TYPES, // 编辑弹窗运动类型选项
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

    // 运动数据网格（Keep 风：标签在上、数值 + 单位在下）
    metrics: [],

    // 特别成就（个人最佳）
    achievements: [],

    // 跑步配速区间（自锚定：边界 = 本次平均配速 × 比例）
    runZones: { hasData: false, zones: [] },
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

      // 海拔曲线数据：只有徒步/爬山出（其余类型 GPS 逐点海拔基本是噪声，曲线没参考意义），
      // 抽稀口径见 utils/track-altitude.js；空数组时 wxml 的 length>1 自然不渲染
      const altitudeChart = buildAltitudeChart(activity.trackPoints, activity.type);

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
      // 最快 1km（服务端分段计算；游泳/骑行无配速概念不展示）
      const fastestParts =
        activity.fastestKm && !['swimming', 'cycling'].includes(activity.type)
          ? formatPaceParts(activity.fastestKm)
          : null;
      // 运动数据网格（参考 Keep：标签在上、大数值 + 小单位在下；缺数据的格不占位）
      // 运动时长 = 扣除暂停；总时长 = 墙钟（含暂停），服务端下发，旧接口/旧数据按墙钟回退
      const paceParts = formatPaceParts(activity.avgPace);
      const totalSec =
        activity.totalDuration != null
          ? activity.totalDuration
          : Math.max(activity.duration || 0, Math.round((endTime - activity.startTime) / 1000));
      const metrics = [
        { label: '运动时长', value: formatDuration(activity.duration) },
        // 两个配速项不带 /公里：标签已写明是配速，与单段明细列头同口径
        paceParts && { label: '平均配速', value: paceParts.value },
        { label: '运动消耗', value: String(activity.calories || 0), unit: '千卡' },
        { label: '总时长', value: formatDuration(totalSec) },
        fastestParts && { label: '最快 1km', value: fastestParts.value },
        { label: '爬升高度', value: String(activity.elevationGain || 0), unit: '米' },
        (activity.markers || []).length > 0 && { label: '打点', value: String(activity.markers.length), unit: '个' },
      ].filter(Boolean);
      // 轨迹线着色：徒步/爬山且有海拔数据 → 按海拔；否则按配速（绝对刻度，越快越偏黄）。
      // 门槛用 utils/track-altitude.js#usesAltitudeColor 而不是「曲线非空」：曲线 1 个点也算非空，
      // 而那个点数画不出线，只会剩下图例骗人。
      const colorMode = usesAltitudeColor(activity.trackPoints, activity.type) ? 'altitude' : 'pace';
      // 最高海拔点（仅海拔着色时在图上标注坐标与海拔值）
      let peakMarker = null;
      if (colorMode === 'altitude') {
        for (const p of activity.trackPoints || []) {
          if (p.altitude != null && (!peakMarker || p.altitude > peakMarker.altitude)) {
            peakMarker = { lat: p.lat, lng: p.lng, altitude: p.altitude };
          }
        }
      }
      // 指标卡右上：当前用户头像与昵称（头像优先 OSS，其次预置头像）
      const me = getApp().globalData.userInfo || {};
      const meAvatar = me.avatarUrl || (me.avatarPreset ? `/assets/avatars/${me.avatarPreset}.png` : '');
      this.setData({
        userAvatar: meAvatar,
        userNickname: me.nickname || '运动用户',
        activity: {
          ...activity,
          icon: meta.icon || '🏃',
          iconImg: meta.iconImg || '',
          label: meta.label || activity.type,
          distanceKm: (activity.distance / 1000).toFixed(2),
          startTimeText: fmtTime(activity.startTime),
          endTimeText: fmtTime(endTime),
          avgAccuracy,
        },
        metrics,
        // 轨迹线着色：徒步/爬山且有海拔数据 → 按海拔；否则按配速（绝对刻度，越快越偏黄）
        colorMode,
        activityType: activity.type,
        peakMarker,
        paceSlowText: (formatPaceParts(getPaceScale(activity.type).slow) || {}).value || '—',
        paceFastText: (formatPaceParts(getPaceScale(activity.type).fast) || {}).value || '—',
        mapPoints: (activity.trackPoints || []).map((p) => ({
          lat: p.lat,
          lng: p.lng,
          altitude: p.altitude != null ? p.altitude : null,
          timestamp: p.timestamp,
          pauseGap: !!p.pauseGap,
          vehicle: !!p.vehicle, // 非运动段（图上灰显）；这层映射不带上字段就被丢掉，地图永远画不出灰线
        })),
        kmMarkers: this.computeKmMarkers(activity.trackPoints || []),
        markers: (activity.markers || []).map((m) => ({ id: m.id, lat: m.lat, lng: m.lng, type: m.type, icon: m.icon })),
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
      // 个人最佳徽章：先取本地缓存，无则拉取一次 /stats/best 并缓存
      const app = getApp();
      const uid = app.globalData.user ? app.globalData.user.id : '';
      let best = getBestCache(uid);
      if (!best) {
        try {
          best = await api.get('/stats/best');
          if (best) {
            setBestCache(uid, best);
          }
        } catch (err) {
          best = null;
        }
      }
      this.setData({ achievements: this.computeBestBadges(activity, best) });
      // 单段明细（每公里分段；默认展示前 10）
      const segs = this.computeKmSegments(activity.trackPoints || []);
      const full = segs.filter((s) => !s.partial);
      if (full.length) {
        // 标记该轨迹最快配速段（完整段中配速最小）
        const fastest = full.reduce((a, b) => (b.durationSec / b.distKm < a.durationSec / a.distKm ? b : a), full[0]);
        fastest.fastest = true;
      }
      this.setData({ kmSegs: segs, displaySegs: segs.slice(0, 5), runZones: this.buildRunZones(activity) });
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

  // ==================== 打点编辑/删除 ====================

  onMarkerTap(e) {
    const markerId = e.detail; // track-map 返回数字 id，需映射回打点
    // 序号圈 id=idx+1；类型图标 id=30000+idx+1（统一映射回打点下标）
    const num = typeof markerId === 'number' ? (markerId >= 30000 ? markerId - 30000 : markerId) : -1;
    const idx = num - 1;
    const list = this.data.markerList;
    if (idx >= 0 && idx < list.length) {
      this.openEditMarker(list[idx]);
    }
  },

  /** 点击打点时间线 → 编辑（非本人只读，仅本人可编辑打点） */
  onTapMarkerItem(e) {
    if (this.data.activity && this.data.activity.isOwner === false) {
      wx.showToast({ title: '只读分享，仅本人可编辑', icon: 'none' });
      return;
    }
    this.openEditMarker(e.currentTarget.dataset.marker);
  },

  openEditMarker(marker) {
    this.setData({
      markerFormVisible: true,
      editMode: true,
      editMarker: marker,
    });
  },

  async onMarkerConfirm(e) {
    const { markerId, type, icon, label, note, photos, existingPhotos } = e.detail;
    if (this.data.markerBusy) return;
    this.setData({ markerBusy: true });

    loading.show('保存中…');
    try {
      // 新图直传（合规检测内置；违规中止）
      const urls = [];
      if (photos && photos.length) {
        for (const f of photos) {
          const up = await uploadPhoto(f);
          if (up && up.tooLarge) {
            loading.hide();
            const mb = (up.sizeBytes / 1024 / 1024).toFixed(1);
            wx.showToast({ title: `照片压缩后仍约 ${mb}MB，超过 1MB 上限，请换一张`, icon: 'none' });
            return;
          }
          if (up && up.blocked) {
            loading.hide();
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
          icon,
          label,
          note,
          photos: finalPhotos,
        });
      }

      loading.hide();
      wx.showToast({ title: '已更新', icon: 'success' });
      this.setData({ markerFormVisible: false });
      await this.loadDetail();
    } catch (err) {
      loading.hide();
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

  /** 判断当前轨迹是否为该类型的个人最佳纪录（用纪录 id 对比） */
  /** 每满一公里的地图标记点（圆圈数字，上限 100 个防长轨迹卡顿） */
  computeKmMarkers(points) {
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
    const out = [];
    let acc = 0;
    let nextKm = 1;
    for (let i = 1; i < points.length && nextKm <= 100; i++) {
      acc += distM(points[i - 1], points[i]);
      if (acc >= nextKm * 1000) {
        out.push({ lat: points[i].lat, lng: points[i].lng, km: nextKm });
        nextKm += 1;
      }
    }
    return out;
  },

  /**
   * 特别成就：本轨迹在所属运动类型中持有的个人最佳（最远距离/最快配速/最长时长/最大爬升）
   * 口径与 /stats/best 一致：最快配速取 fastestKm、最长时长取 duration（运动时长）；数值取本轨迹自身的成绩
   */
  computeBestBadges(activity) {
    const app = getApp();
    const best = getBestCache(app.globalData.user ? app.globalData.user.id : '');
    if (!best) return [];
    const id = String(activity.id || this.data.id);
    const paceParts = formatPaceParts(activity.fastestKm);
    const rows = [
      { list: best.maxDistanceByType, label: '最远距离', value: (activity.distance / 1000).toFixed(2), unit: '公里' },
      paceParts && { list: best.minPaceByType, label: '最快配速', value: paceParts.value, unit: paceParts.unit },
      { list: best.maxDurationByType, label: '最长时长', value: formatDuration(activity.duration), unit: '' },
      activity.elevationGain > 0 && {
        list: best.maxElevationByType,
        label: '最大爬升',
        value: String(activity.elevationGain),
        unit: '米',
      },
    ].filter(Boolean);
    const achievements = [];
    for (const { list, label, value, unit } of rows) {
      const rec = (list || []).find((r) => r.type === activity.type);
      if (rec && String(rec.id) === id) achievements.push({ label, value, unit });
    }
    return achievements;
  },

  /** 每公里分段
   *  pauseGap / 服务端标出的静止时段（still）/ 相邻点间隔 >60s 视为不计时：断档时间不计入段时长，
   *  距离累计保留跨档延续；每凑满 1km 记一段（溢出滚入下一公里），仅轨迹末尾剩余标为余段（partial）
   *  still 与头部「运动时长」同口径（服务端 finish 时已扣除静止），否则各段用时之和会大于运动时长
   *  vehicle（疑似乘车段）与头部「距离」同口径：位移与时长一起剔，否则明细加起来会比头部距离大出一截 */
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
    const GAP_SEC = 60;
    const segs = [];
    let acc = 0; // 当前公里已累计距离（跨暂停/断档延续，不清零）
    let durMs = 0; // 当前公里已累计运动时长（暂停/断档不计）
    let prev = points[0];
    const pushSeg = (partial) => {
      const durationSec = Math.max(1, Math.round(durMs / 1000));
      const distKm = acc / 1000;
      segs.push({
        idx: segs.length + 1,
        distKm,
        distText: distKm.toFixed(2), // WXML 不支持方法调用，距离文本在 JS 里格式化
        durationSec,
        durationText: formatDuration(durationSec),
        paceText: (formatPaceParts(durationSec / distKm) || {}).value || '—', // 列头已有"配速"，不带 /公里 单位
        ...(partial ? { partial: true } : {}),
      });
    };
    for (let i = 1; i < points.length; i++) {
      const p = points[i];
      const dt = (p.timestamp - prev.timestamp) / 1000;
      // 暂停/静止/车速段/断档：时间与距离都不计入，距离零头保留，恢复后继续往 1km 累计
      if (p.pauseGap || p.still || p.vehicle || !Number.isFinite(dt) || dt < 0 || dt > GAP_SEC) {
        prev = p;
        continue;
      }
      acc += distM(prev, p);
      durMs += p.timestamp - prev.timestamp;
      if (acc >= 1000) {
        pushSeg(false);
        acc -= 1000; // 溢出部分滚入下一公里
        durMs = 0;
      }
      prev = p;
    }
    // 最后不足 1km 的余段（位移 >20m 才展示）
    if (acc > 20) pushSeg(true);
    return segs;
  },

  /** 跑步配速区间（自锚定：边界 = 本次平均配速 × 比例；45s 平滑配速按移动时间加权） */
  buildRunZones(activity) {
    if (activity.type !== 'running') return { hasData: false, zones: [] };
    const zones = computeRunPaceZones(activity.trackPoints || [], activity.avgPace);
    if (!zones.hasData) return zones;
    return {
      ...zones,
      anchorText: `平均配速 ${(formatPaceParts(zones.anchorPace) || {}).value}`,
      totalText: formatDuration(zones.totalSec),
    };
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
        'activity.iconImg': meta.iconImg || '',
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
    loading.show('纠偏中…');
    try {
      const data = await api.post(`/activities/${this.data.id}/reprocess`);
      this.loadDetail();
      loading.hide();
      wx.showToast({ title: '纠偏完成', icon: 'success' });
    } catch (e) {
      console.error('纠偏失败', e);
      loading.hide();
      wx.showToast({ title: '纠偏失败', icon: 'none' });
    } finally {
      loading.hide();
    }
  },

  /** 导出 GPX */
  exportGpx() {
    const token = storage.getToken();
    loading.show('生成中…');
    wx.request({
      url: config.API_BASE_URL + '/api' + `/activities/${this.data.id}/gpx`,
      method: 'GET',
      header: { Authorization: `Bearer ${(token && token.accessToken) || ''}` },
      success: (res) => {
        loading.hide();
        if (res.statusCode === 200) {
          // 保存 .gpx 文件并分享（文件传输助手 → 电脑下载）
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
        loading.hide();
        wx.showToast({ title: '导出失败', icon: 'none' });
      },
    });
  },
});

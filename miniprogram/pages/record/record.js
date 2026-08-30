/**
 * 运动进行中页（M2 核心）
 * 流程：选择类型进入 → 创建活动 → 开启定位 → 采点/节流/漂移过滤（tracker）
 *      → 30s 增量上传（sync）→ 打点（marker-form + OSS 照片）→ 暂停/继续 → 结束
 * 结束不直接 finish：跳摘要页，用户确认"保存"才提交 final 包（文档 3.3）
 */
const config = require('../../config/index');
const api = require('../../services/api');
const { Tracker } = require('../../services/tracker');
const { ensureLocationAuth } = require('../../services/location-auth');
const { SyncService } = require('../../services/sync');
const { reverseGeocode } = require('../../services/geo');
const { uploadPhoto } = require('../../services/oss-upload');
const { formatPace } = require('../../utils/format');
const { getBestCache } = require('../../services/storage');

let locationListenerOn = false;

Page({
  data: {
    type: 'running',
    typeLabel: '跑步',
    typeIcon: '🏃',
    typeIconImg: '',

    // 地图
    mapPoints: [], // [{lat, lng}]
    mapMarkers: [],
    currentLocation: null,
    followMode: true,
    mapType: 'standard',
    weakSignal: false,
    currentAccuracy: null,
    heading: -1, // 运动方向（度），-1 表示未计算

    // 实时数据
    stats: {
      distanceKm: '0.00',
      durationText: '00:00',
      paceText: '—',
      altitude: null,
      climb: 0,
      calories: 0,
    },
    paused: false,
    statsCollapsed: false, // 数据面板是否贴左收齐
    _collapsed: false,

    // 打点弹窗
    markerFormVisible: false,
    markerBusy: false,

    // 状态
    starting: true,
    error: '',
    endConfirmVisible: false,
  },

  onLoad(options) {
    // 恢复模式：从首页“运动已暂停”入口进入，让用户选择继续 or 重新开始
    if (options.resume && options.activityId) {
      this.resumeEntry(options.activityId, options.type || 'running');
      return;
    }

    const type = options.type || 'running';
    const meta = config.ACTIVITY_TYPES.find((t) => t.type === type) || {};
    this.setData({ type, typeLabel: meta.label || type, typeIcon: meta.icon || '🏃', typeIconImg: meta.iconImg || '' });

    this.tracker = new Tracker(type, this.getWeightKg());
    this.sync = new SyncService();

    this.init();
  },

  /** 用户体重（卡路里计算用；未设置默认 60kg） */
  getWeightKg() {
    try {
      const app = getApp();
      const u = app.globalData.userInfo;
      if (u && u.weightKg && u.weightKg >= 20 && u.weightKg <= 300) return u.weightKg;
    } catch (e) { /* ignore */ }
    return 60;
  },

  async init() {
    try {
      // 1. 位置权限检查（无权限无法记录轨迹，引导后仍未授权则显示错误 + 重新授权按钮）
      const authed = await ensureLocationAuth();
      if (!authed) {
        this.setData({ starting: false, error: '未获得位置权限，无法记录运动轨迹' });
        return;
      }

      // 2. 创建进行中活动（后端）
      await this.sync.createActivity(this.data.type, Date.now());

      // 3. 开启定位（高精度采集海拔，决策 D16）
      this.startLocation();

      // 4. 屏幕常亮（决策：记录页保持常亮）
      wx.setKeepScreenOn({ keepScreenOn: true });

      // 5. 启动增量上传调度（每 30s）
      this.sync.start(this.tracker);

      this.setData({ starting: false });
      this.updateStats(); // 立即渲染一帧
      this.statsTimer = setInterval(() => this.updateStats(), 1000);
    } catch (e) {
      console.error('[record] init 失败', e);
      this.setData({ error: e.message || '初始化失败' });
    }
  },

  /** 错误状态下的重新授权：授权成功后重新初始化 */
  async retryAuth() {
    const authed = await ensureLocationAuth();
    if (authed) {
      this.setData({ error: '' });
      this.init();
    }
  },

  startLocation() {
    const highOpts = { type: 'gcj02', isHighAccuracy: true };
    // 优先后台定位（运动切后台继续记录）；后台不可用时弹窗让用户选择（去开启 / 仅前台）
    if (wx.startLocationUpdateBackground) {
      wx.startLocationUpdateBackground({
        ...highOpts,
        success: () => {
          this._hasBackgroundAuth = true; // 后台定位可用：切后台持续记录
        },
        fail: (e) => {
          console.warn('[record] startLocationUpdateBackground 不可用', e);
          this._hasBackgroundAuth = false; // 无后台权限：切后台将暂停运动
          this.startForegroundLocation(highOpts);
          // 弹窗让用户选择是否开启后台定位（仅首次弹，避免每次打断）
          if (!this._bgAuthPrompted) {
            this._bgAuthPrompted = true;
            wx.showModal({
              title: '后台定位未开启',
              content: '未开启后台定位，切后台时将暂停记录轨迹。是否去开启？',
              confirmText: '去开启',
              cancelText: '仅前台',
              success: (res) => {
                if (res.confirm) {
                  wx.openSetting({});
                }
              },
            });
          }
        },
      });
    } else {
      this._hasBackgroundAuth = false;
      this.startForegroundLocation(highOpts);
    }

    if (!locationListenerOn) {
      locationListenerOn = true;
      wx.onLocationChange((loc) => {
        const page = getCurrentPages()[getCurrentPages().length - 1];
        if (page && typeof page.onLocation === 'function') {
          page.onLocation(loc);
        }
      });
    }
  },

  /** 前台定位（降级路径：后台定位不可用时） */
  startForegroundLocation(highOpts) {
    wx.startLocationUpdate({
      ...highOpts,
      fail: (e) => {
        console.warn('[record] startLocationUpdate 失败（降级无海拔）', e);
        wx.startLocationUpdate({ type: 'gcj02' });
      },
    });
  },

  /** 定位回调：喂给 tracker + 更新地图 */
  onLocation(loc) {
    // DEBUG: 模拟暂停轨迹用于测试 pauseGap 断开效果
    if (!this._debugSimulated && this.data.mapPoints.length === 0) {
      this._debugSimulated = true;
      const debugPts = [
        { lat: 31.2304, lng: 121.4737 }, // 起点：人民广场附近
        { lat: 31.2310, lng: 121.4750 },
        { lat: 31.2320, lng: 121.4765 },
        { lat: 31.2330, lng: 121.4780 },
        { lat: 31.2340, lng: 121.4795, pauseGap: true }, // 暂停后第一个点（标记）
        { lat: 31.2340, lng: 121.4795 },
        { lat: 31.2355, lng: 121.4810 },
        { lat: 31.2370, lng: 121.4825 },
        { lat: 31.2385, lng: 121.4840 },
      ];
      this.setData({ mapPoints: debugPts });
      console.log('[DEBUG] Simulated track with pauseGap at index 4');
      return;
    }

    if (this.data.paused) return;
    console.log('[record] loc accuracy=', loc.accuracy, 'lat=', loc.latitude, 'lng=', loc.longitude, 'dist=', this.tracker ? this.tracker.distance : '-');
    if (!this._firstLoc) {
      this._firstLoc = true;
      wx.showToast({ title: '已获取定位', icon: 'success' });
    }
    // 实时精度（常驻展示）+ 弱信号提示（accuracy > 45m 时橙色提醒）
    const acc = typeof loc.accuracy === 'number' ? Math.round(loc.accuracy) : null;
    const weak = acc != null && acc > 45;
    this.setData({
      currentAccuracy: acc,
      weakSignal: weak,
    });
    const point = this.tracker.addPoint(loc);
    if (point) {
      let mapPoints = this.data.mapPoints;
      // 暂停恢复后第一个点前插入 gap 标记，让地图组件断开连线
      if (this._pendingPauseGap) {
        this._pendingPauseGap = false;
        mapPoints = mapPoints.concat({ lat: point.lat, lng: point.lng, pauseGap: true });
      }
      mapPoints = mapPoints.concat({ lat: point.lat, lng: point.lng });
      // 计算运动方向（正北顺时针角度）
      let heading = this.data.heading;
      if (mapPoints.length >= 2) {
        const prev = mapPoints[mapPoints.length - 2];
        const cur = mapPoints[mapPoints.length - 1];
        heading = this.calcBearing(prev.lat, prev.lng, cur.lat, cur.lng);
      }
      this.setData({
        mapPoints,
        currentLocation: { latitude: loc.latitude, longitude: loc.longitude },
        'stats.altitude': point.altitude != null ? Math.round(point.altitude) : null,
        heading,
      });
    }
  },

  /** 计算两点间方位角（正北顺时针，0-360度） */
  calcBearing(lat1, lng1, lat2, lng2) {
    const toRad = (d) => (d * Math.PI) / 180;
    const dLng = toRad(lng2 - lng1);
    const y = Math.sin(dLng) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
              Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  },

  /** 每秒刷新数据面板（时长跳动） */
  updateStats() {
    const snap = this.tracker.snapshot();
    this.setData({
      stats: {
        distanceKm: snap.distanceKm,
        durationText: snap.durationText,
        paceText: snap.pace ? formatPace(snap.pace).replace(/\s*\/公里.*$/, '') : '—', // 去单位（底部文案已有 /km）
        altitude: this.data.stats.altitude,
        climb: snap.elevationGain,
        calories: snap.calories,
      },
      paused: snap.paused,
    });
    this.checkBestRecord(snap);
  },

  /**
   * 运动中打破个人最佳 → toast 恭喜（实时拉取个人最佳基准，避免本地缓存滞后误判）
   * - 仅距离/时长/爬升（实时可准确判断；最快配速为 1km 分段口径，运动中无法判定，不提示）
   * - 每次运动每个指标只提示一次
   * - 首次进入异步加载基准（loadBestBase），就绪前不判定
   */
  checkBestRecord(snap) {
    if (this.data.paused) return;
    if (!this._bestLoaded) {
      this._bestLoaded = true;
      this.loadBestBase();
      return; // 基准未就绪不判定
    }
    if (!this._best) return;
    const type = this.data.type;
    const findBest = (rows, key) => {
      const r = (rows || []).find((x) => x.type === type);
      return r ? r[key] : null;
    };
    const checks = [
      { metric: '最远距离', cur: snap.distance, best: findBest(this._best.maxDistanceByType, 'distance'), unit: 'm' },
      { metric: '最长时长', cur: snap.durationSec, best: findBest(this._best.maxDurationByType, 'duration'), unit: 's' },
      { metric: '最大爬升', cur: snap.elevationGain, best: findBest(this._best.maxElevationByType, 'elevationGain'), unit: 'm' },
    ];
    if (!this._bestToasted) this._bestToasted = {};
    for (const ch of checks) {
      if (ch.best == null || ch.cur <= ch.best) continue; // 无历史纪录或未打破
      const key = ch.metric;
      if (this._bestToasted[key]) continue; // 本次运动已提示过
      this._bestToasted[key] = true;
      wx.showToast({ title: `🎉 打破纪录：${ch.metric}！`, icon: 'none', duration: 2500 });
      // 更新本地缓存（新纪录）
      const app = getApp();
      const { setBestCache } = require('../../services/storage');
      const rowsKey = { '最远距离': 'maxDistanceByType', '最长时长': 'maxDurationByType', '最大爬升': 'maxElevationByType' }[ch.metric];
      const rows = this._best[rowsKey] || [];
      const idx = rows.findIndex((x) => x.type === type);
      const rec = { ...(rows[idx] || {}), type, [ch.metric === '最远距离' ? 'distance' : ch.metric === '最长时长' ? 'duration' : 'elevationGain']: Math.round(ch.cur) };
      if (idx >= 0) rows[idx] = rec; else rows.push(rec);
      this._best[rowsKey] = rows;
      setBestCache(app.globalData.user ? app.globalData.user.id : '', this._best);
    }
  },

  /** 异步加载个人最佳基准：实时拉 /stats/best 并写缓存；失败时本地缓存兜底 */
  async loadBestBase() {
    const app = getApp();
    try {
      const best = await api.get('/stats/best');
      this._best = best;
      const { setBestCache } = require('../../services/storage');
      setBestCache(app.globalData.user ? app.globalData.user.id : '', best);
    } catch (e) {
      console.warn('加载个人最佳失败，用本地缓存兜底', e);
      this._best = getBestCache(app.globalData.user ? app.globalData.user.id : '') || null;
    }
  },

  // ==================== 打点 ====================

  openMarkerForm() {
    if (this.data.paused) {
      wx.showToast({ title: '请先继续运动', icon: 'none' });
      return;
    }
    this.setData({ markerFormVisible: true });
  },

  async onMarkerConfirm(e) {
    const { type, note, photos } = e.detail;
    const loc = this.data.currentLocation;
    if (!loc) {
      wx.showToast({ title: '暂未获取到位置', icon: 'none' });
      return;
    }
    if (this.data.markerBusy) return;
    this.setData({ markerBusy: true, markerFormVisible: false });

    try {
      // 多图直传 OSS（每张先微信合规检测，违规中止）
      wx.showLoading({ title: '保存打点…' });
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

      const marker = {
        id: `m_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        lat: loc.latitude,
        lng: loc.longitude,
        timestamp: Date.now(),
        type,
        note,
        photoUrl: urls[0] || '',
        photos: urls,
        address: '',
      };

      // 本地记录（final 包提交）
      this.tracker.addMarker(marker);

      // 实时上报后端（失败不阻塞，final 包兜底）
      this.sync.addMarker(marker).catch(() => {});

      // 地图打点 marker
      const mapMarkers = this.data.mapMarkers.concat({
        id: marker.id,
        lat: marker.lat,
        lng: marker.lng,
        type: marker.type, // 打点类型（地图图标区分）
      });
      this.setData({ mapMarkers });

      // 异步逆地理编码地址（未配置 key 时返回空）
      reverseGeocode(marker.lat, marker.lng).then((address) => {
        if (address) {
          marker.address = address;
        }
      });

      wx.hideLoading();
      wx.showToast({ title: '已打点', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '打点失败', icon: 'none' });
      console.error(err);
    } finally {
      this.setData({ markerBusy: false });
    }
  },

  onMarkerCancel() {
    this.setData({ markerFormVisible: false });
  },

  // ==================== 暂停/继续/结束 ====================

  /** 图层切换（转发给 track-map 组件） */
  switchLayer() {
    const map = this.selectComponent('#trackMap');
    if (map && typeof map.switchLayer === 'function') {
      map.switchLayer();
    }
  },

  cancelEnd() {
    this.setData({ endConfirmVisible: false });
  },

  /** 数据面板：点击贴左收齐 / 展开 */
  toggleStats() {
    this.setData({ statsCollapsed: !this.data.statsCollapsed });
  },

  togglePause() {
    if (this.data.paused) {
      this.tracker.resume();
      // 恢复后第一个有效点前插入 pauseGap 标记，让地图组件断开连线
      this._pendingPauseGap = true;
    } else {
      this.tracker.pause();
    }
    this.updateStats();
  },

  openEndConfirm() {
    // 随时可结束，不做轨迹点数限制
    this.setData({ endConfirmVisible: true });
  },

  /** 结束：停止采集，生成 final 包暂存，跳摘要页 */
  async confirmEnd() {
    this._ending = true; // 标记正常结束（onUnload 不再存“进行中”）
    this.setData({ endConfirmVisible: false, starting: true });

    // 停止定位与调度
    wx.stopLocationUpdate();
    this.sync.stop();
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }

    try {
      wx.showLoading({ title: '生成摘要…' });
      // 终点地址（未配置 key 时为空）
      const last = this.tracker.lastPoint;
      const startAddress = '';
      const endAddress = last ? await reverseGeocode(last.lat, last.lng) : '';

      const finalPack = this.tracker.buildFinalPack(startAddress, endAddress);

      // 暂存全局（摘要页读取；文档：数据由 record 页暂存全局）
      wx.setStorageSync('pending_summary', {
        finalPack,
        stats: this.tracker.getStats(),
        type: this.data.type,
        typeLabel: this.data.typeLabel,
        typeIcon: this.data.typeIcon,
        typeIconImg: this.data.typeIconImg,
      });
      // 暂存 sync 实例（摘要页"保存"时提交 finish）
      wx.setStorageSync('pending_sync_activity', this.sync.activityId);

      wx.hideLoading();
      wx.redirectTo({ url: '/pages/summary/summary' });
    } catch (e) {
      wx.hideLoading();
      console.error('[record] 生成摘要失败', e);
      this.setData({ starting: false });
    }
  },

  /** 放弃本次运动 */
  cancelRecord() {
    wx.showModal({
      title: '放弃本次运动？',
      content: '已采集的数据将不会保存',
      confirmText: '放弃',
      confirmColor: '#ff4d4f',
      success: async (res) => {
        if (res.confirm) {
          this._canceled = true; // 标记已放弃（onUnload 不再存“进行中”）
          wx.stopLocationUpdate();
          this.sync.stop();
          if (this.statsTimer) {
            clearInterval(this.statsTimer);
            this.statsTimer = null;
          }
          // 通知后端取消活动（失败静默）+ 清除“进行中”标记
          this.sync.cancel().catch(() => {});
          wx.removeStorageSync('ongoingActivity');
          wx.switchTab({ url: '/pages/index/index' });
        }
      },
    });
  },

  onHide() {
    if (!this.tracker) return;
    // 切后台：标记时间（回前台时判断是否需要 GPS 预热，避免冷启动定位漂移）
    this.tracker.markBackground();
    // 无后台定位权限：切后台自动暂停（后台无法采点，暂停避免轨迹缺失/跳变）
    if (!this._hasBackgroundAuth && !this.data.paused) {
      this.tracker.pause();
      this._bgPaused = true;
      this.setData({ paused: true });
      this.updateStats();
    }
  },

  onShow() {
    if (!this.tracker) return;
    // 回前台：后台较久则开启预热窗口（丢弃回前台后几秒内的漂移点）
    this.tracker.onForeground();
    // 因无后台权限被自动暂停：保持暂停，提示用户点击「继续」再次开始记录
    if (this._bgPaused) {
      this._bgPaused = false;
      wx.showToast({ title: '后台已暂停运动，点击继续', icon: 'none' });
    }
  },

  onUnload() {
    wx.stopLocationUpdate();
    if (this.sync) this.sync.stop();
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
    wx.setKeepScreenOn({ keepScreenOn: false });

    // 运动进行中退出（非结束跳摘要、非放弃）：自动暂停并保留现场，首页可“继续”
    if (!this._ending && !this._canceled && this.tracker && this.sync && this.sync.activityId) {
      if (!this.tracker.paused) {
        this.tracker.pause();
      }
      wx.setStorageSync('ongoingActivity', {
        activityId: this.sync.activityId,
        type: this.data.type,
        startTime: this.tracker.startTime,
        pausedAt: this.tracker.pausedAt || Date.now(),
        pausedMs: this.tracker.pausedMs,
      });
    }
  },

  /** 首页“运动已暂停”入口：弹窗选择继续 or 重新开始 */
  async resumeEntry(activityId, type) {
    const res = await new Promise((resolve) => {
      wx.showModal({
        title: '继续上次运动？',
        content: '检测到有一条未结束的运动记录',
        confirmText: '继续',
        cancelText: '重新开始',
        success: resolve,
        fail: () => resolve({ confirm: false }),
      });
    });
    if (res.confirm) {
      await this.resume(activityId, type);
    } else {
      // 重新开始：取消旧活动，清现场，走正常新建流程
      const s = new SyncService();
      s.activityId = activityId;
      s.cancel().catch(() => {});
      wx.removeStorageSync('ongoingActivity');
      const meta = config.ACTIVITY_TYPES.find((t) => t.type === type) || {};
      this.setData({ type, typeLabel: meta.label || type, typeIcon: meta.icon || '🏃', typeIconImg: meta.iconImg || '' });
      this.tracker = new Tracker(type, this.getWeightKg());
      this.sync = new SyncService();
      this.init();
    }
  },

  /** 继续上次运动：从后端拉点重建 tracker，保持暂停态，等用户点“继续” */
  async resume(activityId, type) {
    const meta = config.ACTIVITY_TYPES.find((t) => t.type === type) || {};
    this.setData({ type, typeLabel: meta.label || type, typeIcon: meta.icon || '🏃', typeIconImg: meta.iconImg || '' });
    try {
      wx.showLoading({ title: '恢复中…' });
      const activity = await api.get(`/activities/${activityId}`);
      if (!activity || activity.status !== 'in_progress') {
        wx.hideLoading();
        wx.removeStorageSync('ongoingActivity');
        wx.showToast({ title: '该运动已结束', icon: 'none' });
        return;
      }
      this.tracker = new Tracker(type, this.getWeightKg());
      this.tracker.restoreFromPoints(activity.trackPoints, activity.markers, activity.startTime, activity.pausedMs);
      // 退出时已暂停：退出→现在的时长也算暂停（补进 pausedMs），恢复后保持暂停
      const ongoing = wx.getStorageSync('ongoingActivity');
      if (ongoing && ongoing.pausedAt) {
        this.tracker.pausedMs += Math.max(0, Date.now() - ongoing.pausedAt);
      }
      this.tracker.paused = true;
      this.tracker.pausedAt = Date.now();

      this.sync = new SyncService();
      this.sync.activityId = activityId;
      this.sync.lastUploadedSeq = this.tracker.seq; // 已上传到后端的点

      this.setData({
        starting: false,
        paused: true,
        currentAccuracy: null,
        mapPoints: activity.trackPoints.map((p) => ({ lat: p.lat, lng: p.lng })),
        mapMarkers: (activity.markers || []).map((m) => ({ id: m.id, lat: m.lat, lng: m.lng })),
      });

      this.startLocation();
      wx.setKeepScreenOn({ keepScreenOn: true });
      this.sync.start(this.tracker);
      this.updateStats();
      this.statsTimer = setInterval(() => this.updateStats(), 1000);
      wx.hideLoading();
    } catch (e) {
      wx.hideLoading();
      console.error('[record] 恢复运动失败', e);
      wx.showToast({ title: '恢复失败，请重试', icon: 'none' });
    }
  },
});

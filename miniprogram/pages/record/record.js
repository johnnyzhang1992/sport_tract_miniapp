/**
 * 运动进行中页（M2 核心）
 * 流程：选择类型进入 → 创建活动 → 开启定位 → 采点/节流/漂移过滤（tracker）
 *      → 30s 增量上传（sync）→ 打点（marker-form + OSS 照片）→ 暂停/继续 → 结束
 * 结束不直接 finish：跳摘要页，用户确认"保存"才提交 final 包（文档 3.3）
 */
const config = require('../../config/index');
const { Tracker } = require('../../services/tracker');
const { SyncService } = require('../../services/sync');
const { reverseGeocode } = require('../../services/geo');
const { uploadPhoto } = require('../../services/oss-upload');
const { formatPace } = require('../../utils/format');

let locationListenerOn = false;

Page({
  data: {
    type: 'running',
    typeLabel: '跑步',
    typeIcon: '🏃',

    // 地图
    mapPoints: [], // [{lat, lng}]
    mapMarkers: [],
    currentLocation: null,
    followMode: true,
    mapType: 'standard',
    weakSignal: false,
    currentAccuracy: null,

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

    // 打点弹窗
    markerFormVisible: false,
    markerBusy: false,

    // 状态
    starting: true,
    error: '',
    endConfirmVisible: false,
  },

  onLoad(options) {
    const type = options.type || 'running';
    const meta = config.ACTIVITY_TYPES.find((t) => t.type === type) || {};
    this.setData({ type, typeLabel: meta.label || type, typeIcon: meta.icon || '🏃' });

    this.tracker = new Tracker(type, 60);
    this.sync = new SyncService();

    this.init();
  },

  async init() {
    try {
      // 1. 位置权限检查
      const authed = await this.ensureLocationAuth();
      if (!authed) return;

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

  /** 位置权限：拒绝时引导打开设置 */
  ensureLocationAuth() {
    return new Promise((resolve) => {
      wx.getSetting({
        success: (res) => {
          const granted = res.authSetting['scope.userLocation'];
          if (granted === undefined) {
            // 首次：直接发起授权
            wx.authorize({
              scope: 'scope.userLocation',
              success: () => resolve(true),
              fail: () => this.showAuthGuide(() => resolve(false)),
            });
          } else if (granted) {
            resolve(true);
          } else {
            this.showAuthGuide(() => resolve(false));
          }
        },
        fail: () => resolve(false),
      });
    });
  },

  showAuthGuide(cb) {
    wx.showModal({
      title: '需要位置权限',
      content: '运动轨迹记录需要获取您的位置信息，请在设置中开启',
      confirmText: '去设置',
      success: (res) => {
        if (res.confirm) {
          wx.openSetting({ complete: cb });
        } else {
          cb();
        }
      },
      fail: cb,
    });
  },

  startLocation() {
    wx.startLocationUpdate({
      type: 'gcj02',
      isHighAccuracy: true,
      fail: (e) => {
        console.warn('[record] startLocationUpdate 失败（降级无海拔）', e);
        wx.startLocationUpdate({ type: 'gcj02' });
      },
    });

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

  /** 定位回调：喂给 tracker + 更新地图 */
  onLocation(loc) {
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
      const mapPoints = this.data.mapPoints.concat({ lat: point.lat, lng: point.lng });
      this.setData({
        mapPoints,
        currentLocation: { latitude: loc.latitude, longitude: loc.longitude },
        'stats.altitude': point.altitude != null ? Math.round(point.altitude) : null,
      });
    }
  },

  /** 每秒刷新数据面板（时长跳动） */
  updateStats() {
    const snap = this.tracker.snapshot();
    this.setData({
      stats: {
        distanceKm: snap.distanceKm,
        durationText: snap.durationText,
        paceText: snap.pace ? formatPace(snap.pace) : '—',
        altitude: this.data.stats.altitude,
        climb: snap.elevationGain,
        calories: snap.calories,
      },
      paused: snap.paused,
    });
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

  togglePause() {
    if (this.data.paused) {
      this.tracker.resume();
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
          wx.stopLocationUpdate();
          this.sync.stop();
          if (this.statsTimer) {
            clearInterval(this.statsTimer);
            this.statsTimer = null;
          }
          // 通知后端取消活动（失败静默）
          this.sync.cancel().catch(() => {});
          wx.switchTab({ url: '/pages/index/index' });
        }
      },
    });
  },

  onUnload() {
    wx.stopLocationUpdate();
    if (this.sync) this.sync.stop();
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
    wx.setKeepScreenOn({ keepScreenOn: false });
  },
});

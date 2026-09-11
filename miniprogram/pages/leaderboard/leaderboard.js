/**
 * 运动榜（新 tab）：全平台点亮地图 + 按运动类型/省份排行
 * - 地图：canvas 2d 直绘 GeoJSON（utils/map-draw），点亮省按轨迹数上色，点击省份弹窗下钻城市
 *   支持单指拖拽平移、双指捏合缩放（主图与省份弹窗地图均可），缩放后出现"重置地图"
 * - 排行：类型 chips + 省份选择，TOP10 昵称模糊（服务端处理，不可点击），底部当前用户真实排名
 */
const drawGeoMap = require('../../utils/map-draw');
const loading = require('../../utils/loading');

const ACTIVITY_TYPES = require('../../config/index').ACTIVITY_TYPES;

// 省份名 → 行政区划代码（与足迹页一致，用于拉省份城市 GeoJSON）
const PROVINCE_TO_CODE = {
  '北京市': '110000', '天津市': '120000', '河北省': '130000', '山西省': '140000',
  '内蒙古自治区': '150000', '辽宁省': '210000', '吉林省': '220000', '黑龙江省': '230000',
  '上海市': '310000', '江苏省': '320000', '浙江省': '330000', '安徽省': '340000',
  '福建省': '350000', '江西省': '360000', '山东省': '370000', '河南省': '410000',
  '湖北省': '420000', '湖南省': '430000', '广东省': '440000', '广西壮族自治区': '450000',
  '海南省': '460000', '重庆市': '500000', '四川省': '510000', '贵州省': '520000',
  '云南省': '530000', '西藏自治区': '540000', '陕西省': '610000', '甘肃省': '620000',
  '青海省': '630000', '宁夏回族自治区': '640000', '新疆维吾尔自治区': '650000',
  '台湾省': '710000', '香港特别行政区': '810000', '澳门特别行政区': '820000',
};

/** 地图缩放上限 */
const MAX_MAP_SCALE = 8;

/** 平移偏移限幅：地图中心始终留在画布内（scale=1 时不可平移） */
function clampOffset(v, scale, size) {
  const lim = ((scale - 1) / 2) * size;
  return Math.max(-lim, Math.min(lim, v));
}

/** 轨迹数 → 点亮色深浅（浅蓝 → 品牌蓝） */
function heatColor(count, max) {
  const t = Math.min(1, Math.sqrt(count / (max || 1))); // 开方：低值区分度更高
  const r = Math.round(0xcf + (0x2b - 0xcf) * t);
  const g = Math.round(0xe0 + (0x6c - 0xe0) * t);
  const b = Math.round(0xff + (0xf6 - 0xff) * t);
  return `rgb(${r},${g},${b})`;
}

// 性别 → 图标（0 未知/保密 → 锁）
const GENDER_ICONS = {
  0: '/assets/icons/gender-secret.png',
  1: '/assets/icons/gender-male.png',
  2: '/assets/icons/gender-female.png',
};

/** 本榜最佳指标：key → 展示名（顺序后端定，前端只负责文案与格式化） */
const BEST_LABELS = {
  farthest: '最长距离',
  fastestKm: '最快配速',
  fastestAvg: '最快均速',
  maxClimb: '最大爬升',
};

/** 秒 → mm:ss / h:mm:ss */

/** 本榜最佳值格式化：key 决定单位语义（后端只回原始值：米/秒） */
function fmtBestValue(key, v) {
  if (v == null) return '';
  if (key === 'farthest') return `${(v / 1000).toFixed(2)} km`;
  if (key === 'fastestKm') {
    // 秒/公里 → 分'秒"
    const m = Math.floor(v / 60);
    const s = Math.round(v - m * 60);
    return `${m}'${String(s).padStart(2, '0')}"`;
  }
  if (key === 'fastestAvg') return `${v.toFixed(1)} km/h`; // 后端直接回均速 km/h
  if (key === 'maxClimb') return `${Math.round(v)} m`;
  return String(v);
}

/** 头像：OSS 签名 URL 优先 → 预设头像本地资源 → 昵称首字（由 WXML 兒底展示） */
function avatarOf(r) {
  return {
    avatarSrc: r.avatarUrl || (r.avatarPreset ? `/assets/avatars/${r.avatarPreset}.png` : ''),
    avatarText: (r.name || '迹')[0],
  };
}

/** 行数据装饰：性别图标 + 前三名奖牌图标 + 头像（共用 TOP10 / 本榜最佳 / 我的排名卡） */
function decorateRows(board) {
  if (!board) return board;
  const deco = (r) => ({
    ...r,
    genderIcon: GENDER_ICONS[r.gender] || GENDER_ICONS[0],
    medalIcon: r.rank <= 3 ? `/assets/icons/rank-medal-${r.rank}.png` : '',
    ...avatarOf(r),
  });
  return {
    ...board,
    top: (board.top || []).map(deco),
    me: board.me ? deco(board.me) : null,
    best: (board.best || []).filter((b) => b.key !== 'longest').map((b) => ({
      ...b,
      label: BEST_LABELS[b.key] || b.key,
      valueText: fmtBestValue(b.key, b.value),
      ...avatarOf(b),
    })),
  };
}

/** 榜单周期 */
const PERIODS = [
  { key: 'week', label: '周榜' },
  { key: 'month', label: '月榜' },
  { key: 'year', label: '年榜' },
  { key: 'all', label: '总榜' },
];

Page({
  data: {
    loggedIn: false,
    loading: true,
    // 点亮地图
    provinceCount: 0,
    cityCount: 0,
    totalUsers: 0,
    // 排行
    periods: PERIODS,
    periodIndex: 0, // 默认周榜
    types: ACTIVITY_TYPES,
    typeIndex: 0, // 默认散步（config 顺序：0散步 1跑步）
    provinceOptions: ['全国'],
    provinceIndex: 0,
    board: null, // { players, top, me }
    mapScaled: false, // 主图处于缩放/平移状态（展示"重置地图"按钮）
    mapFullscreen: false, // 地图全屏查看
    sharePreview: false, // 分享图预览弹窗
    shareImageSrc: '',
    // 省份弹窗
    provinceModal: false,
    provinceModalName: '',
    provinceCities: [],
    noop() {},
  },

  onLoad() {
    this._chinaMap = null;
    this._provinceMaps = {};
    // 地图手势状态：每张图的视图变换 + 触摸轨迹 + 合帧重绘标记（china 主图 / prov 省份弹窗 / fs 全屏）
    this._views = {
      china: { scale: 1, offsetX: 0, offsetY: 0 },
      prov: { scale: 1, offsetX: 0, offsetY: 0 },
      fs: { scale: 1, offsetX: 0, offsetY: 0 },
    };
    this._mapRts = {};
    this._gestures = {};
    this._renderPending = {};
    this.refresh();
  },

  onShow() {
    // tab 切回时静默刷新排行（保留用户当前选择）
    if (this._loaded) this.refresh(true);
  },

  async refresh(silent = false) {
    const app = getApp();
    if (app.hasSession() && !app.globalData.loggedIn) {
      try { await app.login(); } catch (e) { console.warn('静默登录失败', e); }
    }
    const loggedIn = !!app.globalData.loggedIn;
    this.setData({ loggedIn, loading: !silent && loggedIn });
    if (!loggedIn) return;

    try {
      const api = app.globalData.api;
      const [regions, boardRaw] = await Promise.all([
        api.get('/stats/leaderboard-regions'),
        api.get(`/stats/leaderboard?type=${this.curType()}&province=${encodeURIComponent(this.curProvince())}&period=${this.curPeriod()}`),
      ]);
      const board = decorateRows(boardRaw);
      this._regions = regions;
      const provinceOptions = ['全国', ...regions.provinces.map((p) => p.name)];
      this.setData({
        provinceCount: regions.provinces.length,
        cityCount: regions.cities.length,
        totalUsers: regions.totalUsers,
        provinceOptions,
        board,
        loading: false,
      });
      this._loaded = true;
      // 中国地图数据（省界 GeoJSON）加载后绘制
      const geo = await this.ensureChinaMap();
      if (geo && !this.data.provinceModal) this.drawChinaMap();
    } catch (e) {
      console.error('[leaderboard] 加载失败', e);
      this.setData({ loading: false });
      if (!silent) wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  curType() {
    return this.data.types[this.data.typeIndex].type;
  },
  curProvince() {
    return this.data.provinceOptions[this.data.provinceIndex] || '全国';
  },
  curPeriod() {
    return this.data.periods[this.data.periodIndex].key;
  },
  periodLabel() {
    return this.data.periods[this.data.periodIndex].label;
  },

  async ensureChinaMap() {
    if (this._chinaMap) return this._chinaMap;
    try {
      this._chinaMap = await getApp().globalData.api.get('/geo/china-map');
      return this._chinaMap;
    } catch (e) {
      console.error('加载中国地图失败', e);
      return null;
    }
  },

  /** 查询 canvas 节点并缓存渲染环境（尺寸/dpr/ctx/投影缓存），china / prov / fs 各一份 */
  bindMapCanvas(key, selector) {
    return new Promise((resolve) => {
      this.createSelectorQuery()
        .select(selector)
        .fields({ node: true, size: true, rect: true })
        .exec((res) => {
          if (!res || !res[0] || !res[0].node) { resolve(null); return; }
          const canvas = res[0].node;
          const dpr = (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2) || 2;
          canvas.width = res[0].width * dpr;
          canvas.height = res[0].height * dpr;
          const rt = {
            canvas,
            dpr,
            ctx: canvas.getContext('2d'),
            width: res[0].width,
            height: res[0].height,
            left: res[0].left, // 画布视口位置：触摸坐标 → 画布坐标
            top: res[0].top,
            cache: {}, // 投影结果缓存（传给 drawGeoMap）
            geo: null,
            layer: null, // { valueOf, colorFor }
            unlitColor: key === 'prov' ? '#ececec' : undefined,
            tester: null,
          };
          this._mapRts[key] = rt;
          resolve(rt);
        });
    });
  },

  mapRt(key) {
    return this._mapRts ? this._mapRts[key] : null;
  },

  /** 按当前视图（缩放/平移）重绘地图 */
  renderMap(key) {
    const rt = this.mapRt(key);
    if (!rt || !rt.ctx || !rt.geo || !rt.layer) return;
    rt.ctx.setTransform(rt.dpr, 0, 0, rt.dpr, 0, 0);
    rt.tester = drawGeoMap(rt.ctx, rt.width, rt.height, {
      geojson: rt.geo,
      valueOf: rt.layer.valueOf,
      colorFor: rt.layer.colorFor,
      unlitColor: rt.unlitColor,
      view: this._views[key],
      cache: rt.cache,
    });
  },

  /** 手势期间把重绘合并到每一帧，避免 touchmove 高频重绘掉帧 */
  scheduleMapRender(key) {
    const rt = this.mapRt(key);
    if (!rt || this._renderPending[key]) return;
    this._renderPending[key] = true;
    const run = () => {
      this._renderPending[key] = false;
      this.renderMap(key);
    };
    if (rt.canvas.requestAnimationFrame) rt.canvas.requestAnimationFrame(run);
    else setTimeout(run, 16);
  },

  syncMapScaled(key) {
    if (key !== 'china') return;
    const scaled = this._views.china.scale > 1.01;
    if (scaled !== this.data.mapScaled) this.setData({ mapScaled: scaled });
  },

  /** 主图：全国点亮状态（所有用户） */
  drawChinaMap() {
    if (!this._regions || !this._chinaMap) return Promise.resolve(null);
    const ready = this._mapRts.china ? Promise.resolve(this._mapRts.china) : this.bindMapCanvas('china', '#chinaMap');
    return ready.then((rt) => {
      if (!rt) return null;
      rt.geo = this._chinaMap;
      rt.layer = this._chinaLayer = this.buildChinaLayer();
      this.renderMap('china');
      return rt.tester;
    });
  },

  /** 全国点亮图层：省名 → 轨迹数上色（主图 / 全屏共用同一份） */
  buildChinaLayer() {
    const byName = {};
    this._regions.provinces.forEach((p) => { byName[p.name] = p.count; });
    const max = Math.max(...this._regions.provinces.map((p) => p.count), 1);
    return {
      valueOf: (name) => byName[name],
      colorFor: (name, v) => heatColor(v, max),
    };
  },

  // ---------- 地图手势：单指拖拽平移 / 双指捏合缩放 ----------

  onMapTouchStart(e) {
    const key = e.currentTarget.dataset.map;
    if (!key) return;
    this._gestures[key] = {
      touches: e.touches.map((t) => ({ x: t.clientX, y: t.clientY })),
      dist: 0, // 单指累计位移，超过阈值视为拖拽（抑制随后的 tap）
    };
  },

  onMapTouchMove(e) {
    const key = e.currentTarget.dataset.map;
    const g = this._gestures[key];
    const rt = this.mapRt(key);
    if (!g || !rt) return;
    const ts = e.touches.map((t) => ({ x: t.clientX, y: t.clientY }));
    const prev = g.touches;
    const view = this._views[key];
    let changed = false;

    if (ts.length >= 2 && prev.length >= 2) {
      // 双指捏合：以双指中点为锚缩放，并跟随中点位移（坐标统一到画布系）
      const d0 = Math.max(Math.hypot(prev[0].x - prev[1].x, prev[0].y - prev[1].y), 1);
      const d1 = Math.hypot(ts[0].x - ts[1].x, ts[0].y - ts[1].y);
      const scale = Math.min(MAX_MAP_SCALE, Math.max(1, view.scale * (d1 / d0)));
      const k = scale / view.scale;
      const ax = (prev[0].x + prev[1].x) / 2 - rt.left;
      const ay = (prev[0].y + prev[1].y) / 2 - rt.top;
      const dx = (ts[0].x + ts[1].x) / 2 - (prev[0].x + prev[1].x) / 2;
      const dy = (ts[0].y + ts[1].y) / 2 - (prev[0].y + prev[1].y) / 2;
      view.offsetX = clampOffset(ax + dx - (ax - view.offsetX) * k, scale, rt.width);
      view.offsetY = clampOffset(ay + dy - (ay - view.offsetY) * k, scale, rt.height);
      view.scale = scale;
      changed = true;
    } else if (ts.length === 1 && prev.length === 1 && view.scale > 1) {
      const dx = ts[0].x - prev[0].x;
      const dy = ts[0].y - prev[0].y;
      g.dist += Math.hypot(dx, dy);
      if (g.dist > 6) {
        view.offsetX = clampOffset(view.offsetX + dx, view.scale, rt.width);
        view.offsetY = clampOffset(view.offsetY + dy, view.scale, rt.height);
        changed = true;
      }
    } else if (ts.length === 1 && prev.length === 1) {
      // 未缩放时不可平移，但仍累计位移以抑制 tap
      g.dist += Math.hypot(ts[0].x - prev[0].x, ts[0].y - prev[0].y);
    }
    g.touches = ts;
    if (changed) {
      this.scheduleMapRender(key);
      this.syncMapScaled(key);
    }
  },

  onMapTouchEnd(e) {
    const key = e.currentTarget.dataset.map;
    const g = this._gestures[key];
    if (!g) return;
    if (e.touches && e.touches.length > 0) {
      // 双指抬其一：以剩余手指为新的拖拽起点
      g.touches = e.touches.map((t) => ({ x: t.clientX, y: t.clientY }));
    }
    // 保留手势记录（dist 供 tap 抑制判断），下次 touchstart 重置
  },

  onMapTap(e) {
    const key = e.currentTarget.dataset.map;
    const rt = this.mapRt(key);
    const g = this._gestures[key];
    if (!rt || !rt.tester || (g && g.dist > 6)) return; // 拖拽/缩放后不触发省份点击
    const t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    // tap 的 clientX/Y 是视口坐标，减去画布视口位置才是画布内坐标
    const name = rt.tester.hitTest(t.clientX - rt.left, t.clientY - rt.top);
    if (name && (key === 'china' || key === 'fs')) this.openProvinceModal(name);
  },

  resetMapView() {
    this._views.china = { scale: 1, offsetX: 0, offsetY: 0 };
    this.setData({ mapScaled: false });
    this.renderMap('china');
  },

  // ---------- 缩放按钮 / 全屏 / 分享图导出 ----------

  /** 当前操作的地图：全屏时操作 fs，否则主图 */
  activeMapKey() {
    return this.data.mapFullscreen ? 'fs' : 'china';
  },

  /** 缩放按钮：以画布中心为锚放大/缩小（factor > 1 放大） */
  zoomMapView(factor) {
    const key = this.activeMapKey();
    const rt = this.mapRt(key);
    const view = this._views[key];
    if (!rt || !view) return;
    const scale = Math.min(MAX_MAP_SCALE, Math.max(1, view.scale * factor));
    if (scale === view.scale) return;
    const k = scale / view.scale;
    const ax = rt.width / 2;
    const ay = rt.height / 2;
    view.offsetX = clampOffset(ax - (ax - view.offsetX) * k, scale, rt.width);
    view.offsetY = clampOffset(ay - (ay - view.offsetY) * k, scale, rt.height);
    view.scale = scale;
    this.scheduleMapRender(key);
    this.syncMapScaled(key);
  },

  zoomMapViewIn() {
    this.zoomMapView(1.3);
  },

  zoomMapViewOut() {
    this.zoomMapView(1 / 1.3);
  },

  /** 全屏查看：复用渲染管线，专用 canvas（data-map="fs"）+ 独立视图 */
  openMapFullscreen() {
    if (this.data.mapFullscreen) return;
    if (!this._chinaMap || !this._chinaLayer) {
      wx.showToast({ title: '地图尚未就绪', icon: 'none' });
      return;
    }
    this.setData({ mapFullscreen: true }, async () => {
      // 全屏 canvas 每次 wx:if 重建：重新绑定并复位视图
      this._mapRts.fs = null;
      this._views.fs = { scale: 1, offsetX: 0, offsetY: 0 };
      const rt = await this.bindMapCanvas('fs', '#fsMap');
      if (!rt || !this.data.mapFullscreen) return;
      rt.geo = this._chinaMap;
      rt.layer = this._chinaLayer;
      this.renderMap('fs');
    });
  },

  closeMapFullscreen() {
    this.setData({ mapFullscreen: false });
    this._mapRts.fs = null; // 全屏 canvas 销毁，下次打开重新绑定
  },

  /**
   * 分享图导出：正式海报版式——上部地图区 + 底部标题带
   * 导出必须显式传 width/height/destWidth/destHeight（= 整个 buffer）：
   * 不传时默认值在不同端不一致，真机上可能按逻辑尺寸截取 buffer 左上一块 → 地图被裁剪
   */
  shareMapImage() {
    const key = this.activeMapKey();
    const rt = this.mapRt(key);
    if (!rt || !rt.canvas || !rt.geo || !rt.layer) {
      wx.showToast({ title: '地图尚未就绪', icon: 'none' });
      return;
    }
    loading.show('生成中…');
    const ctx = rt.ctx;
    const BAND = 64; // 底部标题带高度（逻辑 px）
    // 1) 地图完整画进上部区域（fit 投影保证不裁剪；独立 cache 不污染实况渲染）
    ctx.setTransform(rt.dpr, 0, 0, rt.dpr, 0, 0);
    drawGeoMap(ctx, rt.width, rt.height - BAND, {
      geojson: rt.geo,
      valueOf: rt.layer.valueOf,
      colorFor: rt.layer.colorFor,
      unlitColor: rt.unlitColor,
      view: this._views[key],
      cache: {},
    });
    // 2) 白底垫到内容之下（画布平时透明，海报需要不透明背景）
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rt.width, rt.height);
    ctx.globalCompositeOperation = 'source-over';
    // 3) 底部标题带：分隔线 + 主标题 + 数据副标题
    const bandTop = rt.height - BAND;
    ctx.strokeStyle = '#eef0f3';
    ctx.beginPath();
    ctx.moveTo(16, bandTop + 0.5);
    ctx.lineTo(rt.width - 16, bandTop + 0.5);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#1f2329';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText('全国点亮地图', rt.width / 2, bandTop + 10);
    ctx.fillStyle = '#8a93a6';
    ctx.font = '10px sans-serif';
    ctx.fillText(
      `点亮 ${this.data.provinceCount || 0} 省 · ${this.data.totalUsers || 0} 位迹路者 · 小迹一下`,
      rt.width / 2,
      bandTop + 36,
    );
    setTimeout(() => {
      wx.canvasToTempFilePath({
        canvas: rt.canvas,
        x: 0,
        y: 0,
        width: rt.canvas.width,
        height: rt.canvas.height,
        destWidth: rt.canvas.width,
        destHeight: rt.canvas.height,
        fileType: 'png',
        success: (res) => {
          this._shareFilePath = res.tempFilePath;
          this.setData({ sharePreview: true, shareImageSrc: res.tempFilePath });
        },
        fail: (e) => {
          console.error('[leaderboard] 导出分享图失败', e);
          wx.showToast({ title: '生成失败', icon: 'none' });
        },
        complete: () => {
          this.scheduleMapRender(key); // 重绘恢复实况画布（清掉海报内容）
          loading.hide();
        },
      });
    }, 250);
  },

  closeSharePreview() {
    this.setData({ sharePreview: false });
  },

  /** 保存预览图到相册（首次需授权，拒绝后引导去设置） */
  saveShareImage() {
    if (!this._shareFilePath) return;
    wx.saveImageToPhotosAlbum({
      filePath: this._shareFilePath,
      success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        if (msg.includes('auth') || msg.includes('deny') || msg.includes('authorize')) {
          wx.showModal({
            title: '需要相册权限',
            content: '保存图片需要相册权限，是否前往设置开启？',
            confirmText: '去设置',
            success: (r) => {
              if (r.confirm) wx.openSetting();
            },
          });
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' });
        }
      },
    });
  },

  /** 省份弹窗：城市地图（全平台口径）+ 城市点亮列表 */
  async openProvinceModal(name) {
    const code = PROVINCE_TO_CODE[name];
    if (!code) return;
    const cities = (this._regions ? this._regions.cities : []).filter((c) => c.province === name);
    this._modalProvince = name;
    this.setData({ provinceModal: true, provinceModalName: name, provinceCities: cities }, async () => {
      try {
        if (!this._provinceMaps[code]) {
          this._provinceMaps[code] = await getApp().globalData.api.get(`/geo/province-map?adcode=${code}`);
        }
        const geo = this._provinceMaps[code];
        if (!this.data.provinceModal || this._modalProvince !== name) return; // 弹窗已关或已切省
        // 弹窗 canvas 每次 wx:if 重建，需重新绑定并复位视图
        this._mapRts.prov = null;
        this._views.prov = { scale: 1, offsetX: 0, offsetY: 0 };
        const rt = await this.bindMapCanvas('prov', '#provMap');
        if (!rt) return;
        const byName = {};
        cities.forEach((c) => { byName[c.name] = c.count; });
        const max = Math.max(...cities.map((c) => c.count), 1);
        rt.geo = geo;
        rt.layer = {
          valueOf: (n) => byName[n],
          colorFor: (n, v) => heatColor(v, max),
        };
        this.renderMap('prov');
      } catch (e) {
        console.error('加载省份地图失败', e);
        wx.showToast({ title: '地图加载失败', icon: 'none' });
      }
    });
  },

  closeProvinceModal() {
    this.setData({ provinceModal: false });
  },

  /** 弹窗 → 用该省视角看排行 */
  rankThisProvince() {
    const name = this.data.provinceModalName;
    const idx = this.data.provinceOptions.indexOf(name);
    this.setData({
      provinceModal: false,
      provinceIndex: idx >= 0 ? idx : 0,
    });
    this.fetchBoard();
    wx.pageScrollTo({ selector: '.rank-card', duration: 300 });
  },

  onPeriodTap(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (index === this.data.periodIndex) return;
    this.setData({ periodIndex: index });
    this.fetchBoard();
  },

  onTypeTap(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (index === this.data.typeIndex) return;
    this.setData({ typeIndex: index });
    this.fetchBoard();
  },

  onProvinceChange(e) {
    this.setData({ provinceIndex: Number(e.detail.value) });
    this.fetchBoard();
  },

  async fetchBoard() {
    try {
      const board = decorateRows(
        await getApp().globalData.api.get(
          `/stats/leaderboard?type=${this.curType()}&province=${encodeURIComponent(this.curProvince())}&period=${this.curPeriod()}`,
        ),
      );
      this.setData({ board });
    } catch (e) {
      console.error('[leaderboard] 排行加载失败', e);
      wx.showToast({ title: '排行加载失败', icon: 'none' });
    }
  },

  /** 游客登录（页面内引导） */
  async guestLogin() {
    try {
      await getApp().login();
      this.refresh();
    } catch (e) {
      wx.showToast({ title: '登录失败', icon: 'none' });
    }
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh());
  },

  onShareAppMessage() {
    const n = this.data.totalUsers || 0;
    return {
      title: n > 0 ? `运动榜 · 已有${n}位迹路者点亮地图` : '运动榜',
      path: '/pages/leaderboard/leaderboard',
    };
  },
});

// 足迹 tab 主页：地图（marker + 聚合 + 详情弹窗）/ 列表（Task 6）切换 + 数据加载
const api = require('../../services/api');

const MAP_ID = 'footprintMap';
/** marker id 分段（微信 map 的 markerId 是数字）：1..N = records 下标 + 1；≥ 基准则为自绘聚合簇 */
const CLUSTER_ID_BASE = 100000;
/** 聚合格子屏幕边长（px）。越大越容易并成簇 */
const GRID_PX = 56;
/** 可再展开的缩放层级步长 / map scale 取值区间（文档 scale: 3~20） */
const EXPAND_ZOOM_STEP = 2;
const MAX_SCALE = 20;
const MIN_SCALE = 3;
/** fitBounds 上限：多点也不顶到 20（顶满后密集区会糊成一团）；单点固定层级 */
const FIT_MAX_SCALE = 15;
const FIT_SINGLE_SCALE = 12;
/** 视野内边距（CSS px）：底部留出 FAB 与弹窗空间 */
const FIT_PAD_X = 40;
const FIT_PAD_TOP = 50;
const FIT_PAD_BOTTOM = 120;
/** 视野由程序改动后的静默窗口：期间忽略 regionchange，避免和聚合重建互相触发 */
const PROGRAMMATIC_CAMERA_MS = 900;
/** 聚合簇数字气泡缓存（同 track-map 公里标做法：离屏 canvas 画好 → tempFilePath 缓存） */
const CLUSTER_ICON_CACHE = {};

/** 墨卡托世界像素（zoom 0，256px 基准）；某 zoom 下的像素 = 世界像素 * 2^zoom */
function lngToWorldX(lng) {
  return (256 * (lng + 180)) / 360;
}
function latToWorldY(lat) {
  const s = Math.sin((Math.max(-85.05112, Math.min(85.05112, lat)) * Math.PI) / 180);
  return 256 * (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI));
}
function worldYToLat(y) {
  const t = Math.tanh(Math.PI * (1 - (2 * y) / 256));
  return (Math.asin(Math.max(-1, Math.min(1, t))) * 180) / Math.PI;
}

/** 墨卡托投影：经纬度 → 该 zoom 下的世界像素坐标（zoom 直接用 map 的 scale 值） */
function projectLng(lng, zoom) {
  return lngToWorldX(lng) * Math.pow(2, zoom);
}
function projectLat(lat, zoom) {
  return latToWorldY(lat) * Math.pow(2, zoom);
}

/**
 * 手动 fitBounds 算视野。
 * 不用 include-points 的原因（官方文档查证，见 docs/11 §4.2）：
 * include-points 形状是 Array<{latitude,longitude}>，没有 padding 可用（点会贴边被裁一半），
 * 且单点包围盒零面积会把 scale 顶到 20 —— track-map 里已踩过同一个坑。
 */
function fitBounds(points) {
  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;
  points.forEach((p) => {
    minLat = Math.min(minLat, p.latitude);
    maxLat = Math.max(maxLat, p.latitude);
    minLng = Math.min(minLng, p.longitude);
    maxLng = Math.max(maxLng, p.longitude);
  });
  // 单点/零面积包围盒：固定层级直接定位到点（顶满 scale 的老坑）
  if (points.length === 1 || (minLat === maxLat && minLng === maxLng)) {
    return { center: { latitude: points[0].latitude, longitude: points[0].longitude }, scale: FIT_SINGLE_SCALE };
  }
  const view = mapViewport();
  const usableW = Math.max(80, view.width - FIT_PAD_X * 2);
  const usableH = Math.max(80, view.height - FIT_PAD_TOP - FIT_PAD_BOTTOM);
  const center = {
    latitude: worldYToLat((latToWorldY(minLat) + latToWorldY(maxLat)) / 2),
    longitude: (minLng + maxLng) / 2,
  };
  const spanX = lngToWorldX(maxLng) - lngToWorldX(minLng);
  const spanY = latToWorldY(minLat) - latToWorldY(maxLat);
  const z = Math.min(Math.log2(usableW / spanX), Math.log2(usableH / spanY));
  let scale = Number.isFinite(z) ? Math.floor(z) : FIT_MAX_SCALE;
  scale = Math.max(MIN_SCALE, Math.min(FIT_MAX_SCALE, scale));
  return { center, scale };
}

/** 地图可视区（CSS px）：.body 高 = 视口高 - 分段条 112rpx；tabBar 不占 windowHeight */
function mapViewport() {
  const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  const width = (info && info.windowWidth) || 375;
  const height = (info && info.windowHeight) || 600;
  return { width, height: Math.max(200, height - (112 * width) / 750) };
}

/** 网格聚合：同一格（GRID_PX 见方）内的点并成一簇，簇心取成员均值 */
function gridCluster(points, zoom) {
  const cells = {};
  const order = [];
  points.forEach((p) => {
    const gx = Math.floor(projectLng(p.longitude, zoom) / GRID_PX);
    const gy = Math.floor(projectLat(p.latitude, zoom) / GRID_PX);
    const key = gx + ':' + gy;
    if (!cells[key]) {
      cells[key] = [];
      order.push(key);
    }
    cells[key].push(p);
  });
  return order.map((key) => {
    const members = cells[key];
    let lat = 0;
    let lng = 0;
    members.forEach((m) => {
      lat += m.latitude;
      lng += m.longitude;
    });
    return {
      count: members.length,
      latitude: lat / members.length,
      longitude: lng / members.length,
      // 单点簇保留 records 下标，弹窗按它取数据
      recordIndex: members.length === 1 ? members[0].index : -1,
      // 簇内第一个点（/geo 按 visitDate 倒序 → 最新一条），封顶缩放后直接展开它
      firstIndex: members[0].index,
    };
  });
}

/** 画聚合簇气泡（蓝底白字圆 + 白色描边）；不支持离屏 canvas 时返回 ''，调用方退化为 callout 文字 */
function buildClusterIcon(count) {
  const key = 'fp-cluster-' + count;
  if (CLUSTER_ICON_CACHE[key]) return Promise.resolve(CLUSTER_ICON_CACHE[key]);
  return new Promise((resolve) => {
    try {
      const canvas = wx.createOffscreenCanvas({ type: '2d', width: 48, height: 48 });
      const ctx = canvas.getContext('2d');
      ctx.beginPath();
      ctx.arc(24, 24, 21, 0, Math.PI * 2);
      ctx.fillStyle = '#2b6cf6';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      const digits = String(count).length;
      ctx.font = 'bold ' + (digits >= 4 ? 11 : digits === 3 ? 13 : digits === 2 ? 16 : 19) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(count), 24, 25);
      wx.canvasToTempFilePath({
        canvas,
        success: (r) => resolve(r.tempFilePath),
        fail: () => resolve(''),
      });
    } catch (e) {
      resolve('');
    }
  }).then((path) => {
    if (path) CLUSTER_ICON_CACHE[key] = path;
    return path;
  });
}

Page({
  data: {
    mode: 'map', // map | list
    loading: true,
    error: '',
    records: [], // /geo 轻量点缓存 {id,title,visitDate,latitude,longitude,coverPhoto}
    markers: [],
    center: { latitude: 30.5, longitude: 114.3 }, // 视野由 fitBounds 覆盖，这里只是无数据时的兜底
    scale: 12,
    items: [], page: 1, pageSize: 20, total: 0, hasMore: true, loadingList: false,
    popup: { visible: false, record: null },
  },
  onLoad() { this.loadAll(); },
  onShow() {
    const app = getApp();
    if (app.globalData.footprintsDirty) {
      app.globalData.footprintsDirty = false;
      this.loadAll();
    }
  },
  onPullDownRefresh() { this.loadAll().finally(() => wx.stopPullDownRefresh()); },
  async loadAll() {
    // 请求序号守卫：只应用最后一次结果，防竞态
    const seq = (this._seq = (this._seq || 0) + 1);
    // 仅首屏（records/items 都还没内容）才进 loading 态；下拉/footprintsDirty 刷新保留已渲染内容，防闪屏
    const firstLoad = this.data.records.length === 0 && this.data.items.length === 0;
    this.setData(firstLoad ? { loading: true, error: '' } : { error: '' });
    try {
      await Promise.all([this.loadGeo(seq), this.reloadList(seq)]);
      // 守卫同上：刷新期间的旧请求回来不能把 loadingList 复位成失败态之外的值
      if (seq !== this._seq) return;
      this.setData({ loading: false });
    } catch (e) {
      if (seq !== this._seq) return;
      // 复位 loadingList，否则 Task 6 触底闸门会卡死或重复发请求
      this.setData({ loading: false, loadingList: false });
      if (firstLoad) {
        // 首屏失败没有可展示的内容 → 整页错误态
        this.setData({ error: e.message || '加载失败' });
      } else {
        // 刷新失败：已渲染内容仍然可用，只提示不打断（整页错误态留给首屏）
        this.setData({ error: '' });
        wx.showToast({ title: e.message || '刷新失败', icon: 'none' });
      }
    }
  },
  loadGeo(seq) {
    return api.get('/footprint-records/geo').then((data) => {
      if (seq !== this._seq) return;
      this.setData({ records: data.items });
      this.buildMarkers();
    });
  },
  reloadList(seq) {
    // 不提前清空 items：第一页响应到达后再整体替换（见 fetchPage），刷新时列表不留空窗
    this.setData({ page: 1, hasMore: true });
    return this.fetchPage(seq || this._seq);
  },
  fetchPage(seq) {
    this.setData({ loadingList: true });
    const page = this.data.page;
    return api
      .get('/footprint-records', { page, pageSize: this.data.pageSize })
      .then((data) => {
        if (seq !== this._seq) return;
        // page 1（首屏/刷新）替换整页；page > 1（Task 6 触底）追加
        const items = page === 1 ? data.items : this.data.items.concat(data.items);
        this.setData({ items, total: data.total, hasMore: items.length < data.total, loadingList: false });
      })
      .catch((e) => {
        if (seq === this._seq) this.setData({ loadingList: false });
        throw e;
      });
  },

  /**
   * 由 records 生成 markers。
   * fit=false（用户缩放后重建聚合）只换 marker，不动视野，避免和 regionchange 互相打断。
   * 聚合说明：官方 map 没有声明式 clusters 属性/聚合事件（见 docs/11 §4.2 查证结论），
   * 故按当前 zoom 做组件内网格聚合并自绘数字气泡；对外接口（markerId↔records 下标、openPopup）不变。
   */
  buildMarkers(opts) {
    const fit = !opts || opts.fit !== false;
    // 簇图标是离屏 canvas 异步产出的：同样要防竞态，旧一次构建不能覆盖新一批 markers
    const seq = this._seq;
    const records = this.data.records;
    const points = [];
    records.forEach((r, i) => {
      const latitude = Number(r.latitude);
      const longitude = Number(r.longitude);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) points.push({ index: i, latitude, longitude });
    });

    // 先定视野再聚合：聚合格子是按屏幕像素算的，zoom 必须和最终视野一致，否则簇的疏密对不上
    const patch = {};
    if (points.length && fit) {
      const fitted = fitBounds(points);
      patch.center = fitted.center;
      patch.scale = fitted.scale;
      this._gridZoom = fitted.scale;
      this._progCamUntil = Date.now() + PROGRAMMATIC_CAMERA_MS;
    }
    const zoom = this._gridZoom || this.data.scale;
    const clusters = gridCluster(points, zoom);
    this._clusters = clusters;

    return Promise.all(
      clusters.map((c) => (c.count > 1 ? buildClusterIcon(c.count) : Promise.resolve(''))),
    ).then((icons) => {
      const markers = clusters.map((c, ci) => {
        if (c.count === 1) {
          return {
            id: c.recordIndex + 1, // 契约：marker id = records 下标 + 1
            latitude: c.latitude,
            longitude: c.longitude,
            iconPath: '/assets/icons/marker-dot.png',
            width: 18,
            height: 18,
            anchor: { x: 0.5, y: 0.5 },
          };
        }
        const marker = {
          id: CLUSTER_ID_BASE + ci,
          latitude: c.latitude,
          longitude: c.longitude,
          width: 26,
          height: 26,
          anchor: { x: 0.5, y: 0.5 },
        };
        if (icons[ci]) {
          marker.iconPath = icons[ci];
        } else {
          // 离屏 canvas 不可用：退回默认点 + 常显数字气泡，聚合仍可读
          marker.iconPath = '/assets/icons/marker-dot.png';
          marker.callout = { content: String(c.count), color: '#ffffff', fontSize: 12, bgColor: '#2b6cf6', borderRadius: 10, padding: 6, display: 'ALWAYS', textAlign: 'center' };
        }
        return marker;
      });
      if (seq !== this._seq) return;
      this.setData(Object.assign({ markers }, patch));
    });
  },

  /** 视野变化结束时按当前缩放重建聚合分级（跨端字段不一致，取不到用 getScale 兜底） */
  onRegionChange(e) {
    const d = (e && e.detail) || {};
    const type = (e && e.type) || d.type;
    if (type !== 'end') return;
    if (Date.now() < (this._progCamUntil || 0)) return;
    const apply = (raw) => {
      const s = Number(raw);
      if (!Number.isFinite(s)) return;
      if (Math.abs(s - (this._gridZoom || this.data.scale)) < 0.5) return;
      this._gridZoom = s;
      this.buildMarkers({ fit: false });
    };
    const raw = Number.isFinite(e.scale) ? e.scale : Number.isFinite(d.scale) ? d.scale : null;
    if (raw != null) return apply(raw);
    const ctx = wx.createMapContext(MAP_ID, this);
    if (ctx.getScale) ctx.getScale({ success: (r) => apply(r && r.scale), fail: () => {} });
  },

  onMarkerTap(e) {
    const d = (e && e.detail) || {};
    const id = Number(d.markerId);
    if (!Number.isFinite(id)) return;
    if (id >= CLUSTER_ID_BASE) {
      this.expandCluster(id - CLUSTER_ID_BASE);
      return;
    }
    const r = this.data.records[id - 1];
    if (r) this.openPopup(r);
  },
  /** 点聚合簇：放大视野（同原生 zoomOnClick 行为），到顶格后直接展开该处最新一条 */
  expandCluster(idx) {
    const c = (this._clusters || [])[idx];
    if (!c) return;
    const base = Math.max(this._gridZoom || 0, this.data.scale);
    if (base >= MAX_SCALE - 0.5) {
      const r = this.data.records[c.firstIndex];
      if (r) this.openPopup(r);
      return;
    }
    const next = Math.min(MAX_SCALE, base + EXPAND_ZOOM_STEP);
    this._gridZoom = next;
    this._progCamUntil = Date.now() + PROGRAMMATIC_CAMERA_MS;
    this.setData({ center: { latitude: c.latitude, longitude: c.longitude }, scale: next });
    this.buildMarkers({ fit: false });
  },
  /** POI 点击兜底：map 开启 enable-poi 时点到附近标注，按坐标回落到同坐标足迹 */
  onPoiTap(e) {
    const d = (e && e.detail) || {};
    if (!Number.isFinite(d.latitude) || !Number.isFinite(d.longitude)) return;
    const r = this.data.records.find((x) => Number(x.latitude) === d.latitude && Number(x.longitude) === d.longitude);
    if (r) this.openPopup(r);
  },

  /** 详情弹窗：geo/列表轻量数据缺描述与人物时补拉详情（GET /footprint-records/:id，photos 已签名） */
  openPopup(record) {
    const need = !record.location || record.description === undefined || record.people === undefined || record.photos === undefined;
    const fill = need ? api.get('/footprint-records/' + record.id) : Promise.resolve(record);
    fill
      .then((full) => this.showPopup(full))
      .catch((e) => wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' }));
  },
  /** 弹窗渲染前把数组/展示字段算好：WXML 不支持调用 join()，也不能直接渲染数组 */
  showPopup(full) {
    const loc = full.location || {};
    const people = Array.isArray(full.people) ? full.people.filter(Boolean) : [];
    const photos = Array.isArray(full.photos) ? full.photos.filter(Boolean) : [];
    const place = loc.city || loc.address || loc.name || '';
    const record = Object.assign({}, full, {
      people,
      peopleText: people.join('、'),
      photos,
      metaText: [full.visitDate, place].filter(Boolean).join(' · '),
    });
    this.setData({ popup: { visible: true, record } });
  },
  closePopup() { this.setData({ 'popup.visible': false }); },
  editRecord() {
    const rec = this.data.popup.record;
    if (!rec) return;
    this.setData({ 'popup.visible': false });
    wx.navigateTo({ url: '/packageFootRecords/pages/record-edit/record-edit?id=' + rec.id });
  },
  removeRecord() {
    const rec = this.data.popup.record;
    if (!rec) return;
    wx.showModal({
      title: '删除足迹',
      content: '确定删除「' + rec.title + '」？照片将一并移除',
      confirmColor: '#e54d42',
      success: (res) => {
        if (!res.confirm) return;
        api
          .del('/footprint-records/' + rec.id)
          .then(() => {
            this.setData({ 'popup.visible': false });
            wx.showToast({ title: '已删除', icon: 'success' });
            this.loadAll();
          })
          .catch((e) => wx.showToast({ title: (e && e.message) || '删除失败', icon: 'none' }));
      },
    });
  },
  previewPhoto(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const urls = ds.urls || [];
    if (!urls.length) return;
    wx.previewImage({ urls, current: urls[Number(ds.idx) || 0] });
  },

  switchMode(e) { this.setData({ mode: e.currentTarget.dataset.mode }); },
  openAdd() { wx.navigateTo({ url: '/packageFootRecords/pages/record-edit/record-edit' }); },
  noop() {},
});

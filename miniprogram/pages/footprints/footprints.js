// 足迹 tab 主页：地图（原生 marker 聚合 + 详情弹窗）/ 列表（Task 6）切换 + 数据加载
const api = require('../../services/api');
const geo = require('../../utils/footprint-geo');

const MAP_ID = 'footprintMap';
/** map scale 上限（文档 scale: 3~20）：原生聚合到顶仍并在一起的簇（同坐标点）走成员列表兜底 */
const MAX_SCALE = 20;
/** 视野由程序改动后的静默窗口：期间忽略 regionchange 回读，避免自激 */
const PROGRAMMATIC_CAMERA_MS = 900;

/**
 * 列表卡展示字段在 JS 侧一次算好：
 * WXML 不能对 people 数组做 join（直接渲染会变成 [object]），也不能给缺失的 location 兜底，
 * 故卡片额外挂 peopleText / subText / cover（openPopup 收的是原 DTO 字段，附加字段不影响快路径）。
 */
function toCard(r) {
  const people = Array.isArray(r.people) ? r.people.filter(Boolean) : [];
  const photos = Array.isArray(r.photos) ? r.photos.filter(Boolean) : [];
  const loc = r.location || {};
  return Object.assign({}, r, {
    peopleText: people.join('、'),
    subText: [r.visitDate, loc.city || loc.address || loc.name || '未知地点'].filter(Boolean).join(' · '),
    cover: photos[0] || '',
  });
}

/** 地图可视区（CSS px）：.body 高 = 视口高 - 分段条 112rpx；tabBar 不占 windowHeight */
function mapViewport() {
  const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  const width = (info && info.windowWidth) || 375;
  const height = (info && info.windowHeight) || 600;
  return { width, height: Math.max(200, height - (112 * width) / 750) };
}

Page({
  data: {
    mode: 'map', // map | list
    loading: true,
    error: '',
    records: [], // /geo 轻量点缓存 {id,title,visitDate,latitude,longitude,coverPhoto}
    center: { latitude: 30.5, longitude: 114.3 }, // 视野由 fitBounds 覆盖，这里只是无数据时的兜底
    scale: 12,
    items: [], page: 1, pageSize: 20, total: 0, hasMore: true, loadingList: false,
    popup: { visible: false, record: null },
    clusterSheet: { visible: false, records: [] }, // 最大缩放兜底：同处多条足迹的成员列表
  },
  onLoad() { this.loadAll(); },
  onShow() {
    const app = getApp();
    if (app.globalData.footprintsDirty) {
      app.globalData.footprintsDirty = false;
      this.loadAll();
    }
  },

  async loadAll() {
    // 请求序号守卫：只应用最后一次结果，防竞态
    const seq = (this._seq = (this._seq || 0) + 1);
    // 仅首屏（records/items 都还没内容）才进 loading 态；下拉/footprintsDirty 刷新保留已渲染内容，防闪屏
    const firstLoad = this.data.records.length === 0 && this.data.items.length === 0;
    this.setData(firstLoad ? { loading: true, error: '' } : { error: '' }, () => this.trackMapNode());
    try {
      await Promise.all([this.loadGeo(seq), this.reloadList(seq)]);
      // 守卫同上：刷新期间的旧请求回来不能把 loadingList 复位成失败态之外的值
      if (seq !== this._seq) return;
      // setData 回调里 map 节点已渲染：消费挂起的原生聚合 marker（冷启动首屏唯一注入路径；
      // 实测 map 的 bindload 在本模拟器不触发，故不能只靠 onMapLoad）
      this.setData({ loading: false }, () => this.syncNativeMarkers());
    } catch (e) {
      if (seq !== this._seq) return;
      // 复位 loadingList，否则 Task 6 触底闸门会卡死或重复发请求
      this.setData({ loading: false, loadingList: false });
      if (firstLoad) {
        // 首屏失败没有可展示的内容 → 整页错误态
        this.setData({ error: e.message || '加载失败' }, () => this.trackMapNode());
      } else {
        // 刷新失败：已渲染内容仍然可用，只提示不打断（整页错误态留给首屏）
        this.setData({ error: '' }, () => this.trackMapNode());
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
        const fresh = (data.items || []).map(toCard);
        const items = page === 1 ? fresh : this.data.items.concat(fresh);
        // 触底闸门（Task 4 review 硬约束）：只看 hasMore + loadingList，不算页码。
        // fresh 为空也要落下 hasMore，否则后端 total 与实际条数不一致时会一直重试同一页
        this.setData({
          items,
          total: data.total,
          hasMore: fresh.length > 0 && items.length < data.total,
          loadingList: false,
        });
      })
      .catch((e) => {
        if (seq === this._seq) this.setData({ loadingList: false });
        throw e;
      });
  },

  /** 列表触底翻页：不提前清空 items，追加由 fetchPage 的 page > 1 分支负责 */
  onListReachBottom() {
    if (!this.data.hasMore || this.data.loadingList) return;
    const seq = this._seq; // 发请求前先记下当前序号，回退时据此判断这次翻页是否已被新请求接管
    const next = this.data.page + 1;
    this.setData({ page: next });
    this.fetchPage(seq).catch(() => {
      // 翻页失败要退回上一页码，否则这次触底白翻一页、数据留空洞；
      // 三个条件缺一不可：seq 变了说明已被 loadAll/reloadList 接管（页码已归 1，回退会写出错误页码），
      // loadingList 为 true 说明有更新的一页在飞（此时 this.data.page 属于那次请求，不能按 next 回退），
      // page !== next 说明页码已被别处改动
      if (seq === this._seq && !this.data.loadingList && this.data.page === next) this.setData({ page: next - 1 });
    });
  },
  onCardTap(e) {
    const r = this.data.items[Number(e.currentTarget.dataset.idx)];
    if (r) this.openPopup(r); // items 是完整 DTO：弹窗不再二次请求（openPopup 快路径）
  },

  /**
   * 由 records 生成 marker 并注入原生聚合（官方 map「marker 聚合」：initMarkerCluster + addMarkers，基础库 ≥2.8.0）。
   * 修复轮模拟器实测（证据见 task-5-report Fix round 1）：自带蓝底数字气泡正常渲染、
   * 稀疏孤点走普通 marker（iconPath + bindmarkertap），契约不变：markerId = records 下标 + 1、openPopup(record)。
   * 要点（按官方文档与社区坑）：
   * - 原生聚合要求 marker 由 MapContext.addMarkers 命令式注入（声明式 markers 属性不参与聚合），
   *   故 wxml 的 map 不绑 markers 属性
   * - enableDefaultStyle:true —— 地图自带聚合簇气泡（需求原话「地图自带的聚合簇」）；
   *   社区坑：false 时簇点击事件在部分端不派发，且簇图标要自备
   * - zoomOnClick:true —— 点簇原生放大展开；展开后的叶 marker 点击走 bindmarkertap → openPopup
   * - 实测模拟器里带 joinCluster 的孤点也会被画成「1」字气泡，与「稀疏区域直接展示点」不符：
   *   joinCluster 只给本地网格（geo.gridCluster）判定为多点同处的点
   * - 注入时机：marker 只能投给「已存在的 map 节点」。wxml 的 loading / error 闸门会把整块
   *   （含 map）挡在节点树外，冷启动首屏必然处于该状态，所以 buildMarkers 里不直接消费，
   *   payload 留在 _pendingNative，由渲染驱动的钩子（setData({loading:false}) 回调 / bindload /
   *   switchMode 回调）注入；节点已挂载（下拉刷新、dirty 刷新）时同一条路径就地注入
   * fit=false（保留 Task 4 语义）只重投 marker，不动视野。
   */
  buildMarkers(opts) {
    const fit = !opts || opts.fit !== false;
    // 簇图标注入是异步的：同样要防竞态，旧一次构建不能覆盖新一批 marker
    const seq = this._seq;
    const records = this.data.records;
    const points = [];
    records.forEach((r, i) => {
      const latitude = Number(r.latitude);
      const longitude = Number(r.longitude);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) points.push({ index: i, latitude, longitude });
    });

    // 先定视野再分桶：joinCluster 判定按最终视野的 zoom 做，否则簇的疏密对不上
    const patch = {};
    if (points.length && fit) {
      const fitted = geo.fitBounds(points, mapViewport());
      patch.center = fitted.center;
      patch.scale = fitted.scale;
      this._gridZoom = fitted.scale;
      this._progCamUntil = Date.now() + PROGRAMMATIC_CAMERA_MS;
    }
    const zoom = this._gridZoom || this.data.scale;
    const clusters = geo.gridCluster(points, zoom);
    const inCluster = {};
    clusters.forEach((c) => {
      if (c.count > 1) c.members.forEach((i) => { inCluster[i] = true; });
    });
    const markers = points.map((p) => ({
      id: p.index + 1, // 契约：marker id = records 下标 + 1
      latitude: p.latitude,
      longitude: p.longitude,
      joinCluster: !!inCluster[p.index],
      iconPath: '/assets/icons/marker-dot.png',
      width: 18,
      height: 18,
      anchor: { x: 0.5, y: 0.5 },
    }));
    // 顺序很重要：先过 seq 守卫，再挂 marker 载荷 —— 被后续批次取代的构建既不注入，
    // 也不占用 _pendingNative（否则会把过期 payload 留给渲染钩子，甚至覆盖更新的一批）
    return Promise.resolve().then(() => {
      if (seq !== this._seq) return;
      this._pendingNative = { markers, clusters };
      this._clusters = clusters; // 防竞态通过后再提交，旧一次构建不覆盖簇数据
      this.setData(patch);
      // 已挂载 → 立即注入；未挂载（loading / 错误态 / 列表模式）→ 载荷留在 _pendingNative，
      // 由渲染驱动的钩子（setData({loading:false}) 回调 / onMapLoad / switchMode 回调）消费
      return this.syncNativeMarkers();
    });
  },

  /**
   * map 节点存在性判定 + 生命周期记账。
   * 存在条件与 wxml 闸门严格一致：loading / error 期间整块 <block wx:else>（含 map）不存在，
   * 列表模式下 map 也被 wx:if 销毁 —— 此时 createMapContext / addMarkers 打到的是空节点。
   * 由「不可见 → 可见」的跃迁说明节点是新建的，聚合初始化与事件绑定必须重做一次。
   */
  trackMapNode() {
    const mounted = !this.data.loading && !this.data.error && this.data.mode === 'map';
    if (mounted && !this._mapMounted) {
      this._nativeInited = false; // 节点重建：initMarkerCluster / ctx.on 重新来一次
      this._handlersBound = false;
      this._clusterMembers = {}; // clusterId → markerIds：markerClusterCreate 事件回灌，成员列表兜底用
    }
    this._mapMounted = mounted;
    return mounted;
  },

  /** 把待注入的原生 marker 交给 map：map 节点存在时立即消费，否则保留 payload 等渲染钩子再调 */
  syncNativeMarkers() {
    const mounted = this.trackMapNode();
    if (!this._pendingNative) return Promise.resolve();
    if (!mounted) return Promise.resolve(); // 节点不存在：pending 原样留着，不能空转消费掉
    const pending = this._pendingNative;
    this._pendingNative = null;
    this._lastNativeMarkers = pending.markers; // 模式切换重建 map 节点后重投用
    const ctx = wx.createMapContext(MAP_ID, this);
    // 一个节点生命周期内只绑一次事件：否则每次刷新都会重复注册，同一事件回调被调用多遍
    if (!this._handlersBound) {
      this._handlersBound = true;
      ctx.on('markerClusterCreate', (e) => {
        const cs = (e && e.detail && e.detail.clusters) || [];
        cs.forEach((c) => {
          if (c && c.clusterId != null) this._clusterMembers[c.clusterId] = c.markerIds || [];
        });
      });
      ctx.on('markerClusterClick', (e) => this.onNativeClusterClick(e));
    }
    // 聚合初始化同样一次一节点：后续刷新只 addMarkers({clear:true}) 换点
    if (!this._nativeInited) {
      this._nativeInited = true;
      ctx.initMarkerCluster({
        enableDefaultStyle: true,
        zoomOnClick: true,
        gridSize: 60,
        minClusterSize: 2, // 默认 3；足迹两点即并簇更贴近密度需求
        // 默认簇样式微调（旧基础库不支持时静默忽略）：缩小圆圈、统一品牌蓝底白字
        size: 28,
        color: '#ffffff',
        bgColor: '#2b6cf6',
        borderWidth: 2,
        borderColor: '#ffffff',
        fail: (e) => console.error('[footprints] initMarkerCluster fail', e),
      });
    }
    // 每次重投 marker 前清簇成员缓存：addMarkers({clear:true}) 后旧的 clusterId → markerIds
    // 映射随之失效（真机上原生簇 id 会被复用），留着会让 onNativeClusterClick 按陈旧成员
    // 开错记录。节点未重建时 trackMapNode 不会复位，故在这里自行清空，等新的
    // markerClusterCreate 回灌。
    this._clusterMembers = {};
    // 实测模拟器只回 success、不回 onComplete：两个都挂，谁先到算谁
    return new Promise((resolve) => {
      let done = false;
      const finish = (err) => {
        if (done) return;
        done = true;
        if (err) console.error('[footprints] addMarkers fail', err);
        resolve();
      };
      ctx.addMarkers({ markers: pending.markers, clear: true, onComplete: () => finish(), success: () => finish(), fail: finish });
    });
  },
  /** map 渲染完成（部分端支持）：消费挂起的 marker；不支持时由 setData 回调兜底 */
  onMapLoad() {
    this.syncNativeMarkers();
  },

  /** 视野变化结束时记录当前缩放（原生自管聚合，无需重建；跨端字段不一致，取不到用 getScale 兜底） */
  onRegionChange(e) {
    const d = (e && e.detail) || {};
    const type = (e && e.type) || d.type;
    if (type !== 'end') return;
    if (Date.now() < (this._progCamUntil || 0)) return;
    const apply = (raw) => {
      const s = Number(raw);
      if (!Number.isFinite(s)) return;
      this._gridZoom = s; // 最大缩放簇兜底判断用
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
    const r = this.data.records[id - 1];
    if (r) this.openPopup(r);
  },
  /**
   * 原生聚合：点自带簇气泡（enableDefaultStyle 下簇点击不走 bindmarkertap，走 markerClusterClick）。
   * 单成员簇 = 点 marker 语义 → 详情弹窗；多成员未到顶 → 放大展开由原生 zoomOnClick 负责；
   * 最大缩放仍并在一起（同坐标点原生拆不开）→ 成员列表兜底。
   * 成员优先取 markerClusterCreate 回灌的 markerIds，取不到用本地网格桶按簇心匹配。
   * 注：本模拟器未派发过 markerClusterCreate/markerClusterClick（已留档），该链路以真机回归为准（docs/11 §6）。
   */
  onNativeClusterClick(e) {
    const d = (e && e.detail) || {};
    const ids = (this._clusterMembers && this._clusterMembers[d.clusterId]) || [];
    let recs = ids.map((id) => this.data.records[id - 1]).filter(Boolean);
    if (!recs.length) {
      const center = d.center || {};
      const c = (this._clusters || []).find(
        (x) =>
          Number.isFinite(center.latitude) &&
          Math.abs(x.latitude - center.latitude) < 0.01 &&
          Math.abs(x.longitude - center.longitude) < 0.01,
      );
      if (c) recs = c.members.map((i) => this.data.records[i]).filter(Boolean);
    }
    if (recs.length === 1) {
      this.openPopup(recs[0]);
      return;
    }
    if (recs.length > 1 && (this._gridZoom || this.data.scale) >= MAX_SCALE - 0.5) {
      this.showClusterMembers(recs);
    }
  },
  /** POI 点击兜底：点到底图同坐标标注时，按坐标回落到该足迹 */
  onPoiTap(e) {
    const d = (e && e.detail) || {};
    if (!Number.isFinite(d.latitude) || !Number.isFinite(d.longitude)) return;
    const r = this.data.records.find((x) => Number(x.latitude) === d.latitude && Number(x.longitude) === d.longitude);
    if (r) this.openPopup(r);
  },

  /** 详情弹窗：geo/列表轻量数据缺描述与人物时补拉详情（GET /footprint-records/:id，photos 已签名） */
  openPopup(record) {
    // 连点两个 marker 时旧详情响应不能覆盖新弹窗（seq 守卫，同 loadAll 做法）
    const seq = (this._popupSeq = (this._popupSeq || 0) + 1);
    const need = !record.location || record.description === undefined || record.people === undefined || record.photos === undefined;
    const fill = need ? api.get('/footprint-records/' + record.id) : Promise.resolve(record);
    fill
      .then((full) => {
        if (seq === this._popupSeq) this.showPopup(full);
      })
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

  /** 最大缩放仍并簇的兜底：成员列表半屏（标题+日期，点行 → 详情弹窗） */
  showClusterMembers(recs) {
    const records = recs.map((r) => ({ id: r.id, title: r.title, visitDate: r.visitDate }));
    this.setData({ clusterSheet: { visible: true, records } });
  },
  closeClusterSheet() { this.setData({ 'clusterSheet.visible': false }); },
  pickClusterMember(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const r = (this.data.clusterSheet.records || [])[idx];
    this.setData({ 'clusterSheet.visible': false });
    if (r) this.openPopup(r);
  },

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

  switchMode(e) {
    this.setData({ mode: e.currentTarget.dataset.mode }, () => {
      // 切回地图时 wx:if 重建了 map 节点：把上一批 marker 重新挂成 pending，
      // 由 syncNativeMarkers 统一消费（trackMapNode 检出节点重建 → 重做一次 init + 绑一次事件）；
      // 切到列表时同样调一次，仅为让 trackMapNode 记录「节点已销毁」
      if (this.data.mode === 'map' && !this._pendingNative && this._lastNativeMarkers) {
        this._pendingNative = { markers: this._lastNativeMarkers };
      }
      this.syncNativeMarkers();
    });
  },
  openAdd() { wx.navigateTo({ url: '/packageFootRecords/pages/record-edit/record-edit' }); },
  noop() {},
});

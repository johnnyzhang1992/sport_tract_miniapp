// 足迹 tab 主页：地图（本地网格聚合 + 自绘小圆气泡 marker / 详情弹窗）/ 列表（Task 6）切换 + 数据加载
const api = require('../../services/api');
const geo = require('../../utils/footprint-geo');

const MAP_ID = 'footprintMap';
/** map scale 上限（文档 scale: 3~20）：到顶仍同格（同坐标点本地网格也拆不开）→ 成员半屏列表兜底 */
const MAX_SCALE = 20;
/** 点簇气泡一次放大的层级步长（对齐原生 zoomOnClick 手感） */
const EXPAND_ZOOM_STEP = 2;
/** 视野由程序改动后的静默窗口：期间忽略 regionchange 回读，避免自激 */
const PROGRAMMATIC_CAMERA_MS = 900;
/** marker id 分段（微信 map 的 markerId 是数字）：1..N = records 下标 + 1；≥ 基准则为自绘聚合簇 */
const CLUSTER_ID_BASE = 100000;

/** —— 自绘簇气泡样式（用户要求尺寸/配色可控，直接改这四个常量）——
 * 原生默认聚合簇实测不可缩（3104c7c 给 initMarkerCluster 加的 size/color 等参数被运行时忽略），
 * 故簇气泡改回离屏 canvas 自绘小圆：直径 24 CSS px，画布按 2x（48px）出图保证清晰度 */
const CLUSTER_BUBBLE_SIZE = 24; // marker 显示直径（CSS px）
const CLUSTER_BG_COLOR = '#2b6cf6';
const CLUSTER_TEXT_COLOR = '#ffffff';
const CLUSTER_BORDER_WIDTH = 2; // 白描边（CSS px，画布上 ×2）
/** 聚合簇数字气泡缓存（同 track-map 公里标做法：离屏 canvas 画好 → tempFilePath 按 count 缓存） */
const CLUSTER_ICON_CACHE = {};

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

/** 画聚合簇小圆气泡（蓝底白字 + 白描边，2x 出图）；>2 位数字逐级缩字号防溢出。
 *  不支持离屏 canvas 时返回 ''，调用方退化为默认点 + callout 数字，聚合仍可读 */
function buildClusterIcon(count) {
  const key = 'fp-cluster-' + count;
  if (CLUSTER_ICON_CACHE[key]) return Promise.resolve(CLUSTER_ICON_CACHE[key]);
  return new Promise((resolve) => {
    try {
      const px = CLUSTER_BUBBLE_SIZE * 2;
      const border = CLUSTER_BORDER_WIDTH * 2;
      const canvas = wx.createOffscreenCanvas({ type: '2d', width: px, height: px });
      const ctx = canvas.getContext('2d');
      ctx.beginPath();
      ctx.arc(px / 2, px / 2, px / 2 - border / 2, 0, Math.PI * 2);
      ctx.fillStyle = CLUSTER_BG_COLOR;
      ctx.fill();
      ctx.lineWidth = border;
      ctx.strokeStyle = CLUSTER_TEXT_COLOR;
      ctx.stroke();
      ctx.fillStyle = CLUSTER_TEXT_COLOR;
      const digits = String(count).length;
      ctx.font = 'bold ' + (digits >= 4 ? 11 : digits === 3 ? 13 : digits === 2 ? 16 : 19) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(count), px / 2, px / 2 + 1);
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
    markers: [], // 本地网格聚合产物：叶 marker + 自绘簇气泡 marker，声明式绑给 <map>
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
    // 仅首屏（records/items 都还没内容）才进 loading 态；刷新保留已渲染内容，防闪屏
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
      // return 出去：markers 与 loading:false 落在同一帧（否则首屏会先闪一帧无 marker 的空图）
      return this.buildMarkers();
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
   * 由 records 生成 markers（本地网格聚合 + 自绘小圆气泡，<map> 声明式 markers 绑定）。
   * 原生聚合已整体废弃：3104c7c 实测默认簇气泡不可缩（initMarkerCluster 的 size/color 参数被运行时忽略），
   * 组件内网格聚合（utils/footprint-geo.js#gridCluster）重新成为唯一路线，marker 全部回到 setData：
   * 挂载时序不再有问题——loading/error 闸门或模式切换把 map 节点重建时，声明式属性自动带上最新 markers。
   * fit=false（用户缩放后重建聚合）只换 marker，不动视野，避免和 regionchange 互相打断。
   * 契约：叶 marker id = records 下标 + 1；簇 marker id = CLUSTER_ID_BASE + 簇在 _clusters 中的下标。
   */
  buildMarkers(opts) {
    const fit = !opts || opts.fit !== false;
    // 簇图标是离屏 canvas 异步产出的：同样要防竞态，旧一次构建不能覆盖新一批 markers
    // 构建令牌：canvas 在途期间 regionchange / expandCluster / loadAll 可以并发再进来构建，
    // 只靠 _seq（管数据新鲜度）拦不住「同一批数据被构建了两次」的互相覆盖，
    // 故每次构建取一个单调递增号，提交时号已被后来者取走、或 records 已换过 → 整次构建作废
    const build = (this._buildSeq = (this._buildSeq || 0) + 1);
    const seq = this._seq;
    const records = this.data.records; // 记下本次构建用的数组身份，提交时校验（loadGeo 会整体换新数组）
    const points = [];
    records.forEach((r, i) => {
      const latitude = Number(r.latitude);
      const longitude = Number(r.longitude);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) points.push({ index: i, latitude, longitude });
    });

    // 先定视野再聚合：格子按屏幕像素切（utils/footprint-geo.js），zoom 必须和最终视野一致，否则簇的疏密对不上
    // 但这次只落到局部变量 fittedZoom：_gridZoom 的写入推到下方提交点，被令牌作废的过期构建不会留下孤儿值
    const patch = {};
    let fittedZoom = null;
    if (points.length && fit) {
      const fitted = geo.fitBounds(points, mapViewport());
      patch.center = fitted.center;
      patch.scale = fitted.scale;
      fittedZoom = fitted.scale;
      // 静默窗口不在这里打点：出图要等若干个 microtask，若在 await 之前起算，900ms 会被等待消耗掉一块，
      // 提交时窗口可能已过期 → 用户手势和这次 fit 互相打断。改到下方相机真正落地处打点。
    }
    const zoom = fittedZoom || this._gridZoom || this.data.scale;
    const clusters = geo.gridCluster(points, zoom);

    // 一次构建内按 distinct count 出图：CLUSTER_ICON_CACHE 只在出图「完成后」写入，拦不住在途并发，
    // 直接 map 的话 30 个「2」字簇会向离屏 canvas 发 30 次一模一样的绘制请求
    const iconJobs = new Map();
    clusters.forEach((c) => {
      if (c.count > 1 && !iconJobs.has(c.count)) iconJobs.set(c.count, buildClusterIcon(c.count));
    });

    return Promise.all(clusters.map((c) => (c.count > 1 ? iconJobs.get(c.count) : Promise.resolve('')))).then((icons) => {
      // 被后续构建/刷新取代：既不 setData，也不覆盖 _clusters（否则 expandCluster 会按陈旧桶开错记录）
      if (seq !== this._seq || build !== this._buildSeq || records !== this.data.records) return;
      const markers = clusters.map((c, ci) => {
        if (c.count === 1) {
          // 稀疏点：普通叶 marker，点击直接开详情
          return {
            id: c.recordIndex + 1,
            latitude: c.latitude,
            longitude: c.longitude,
            iconPath: '/assets/icons/marker-dot.png',
            width: 18,
            height: 18,
            anchor: { x: 0.5, y: 0.5 },
          };
        }
        const marker = {
          id: CLUSTER_ID_BASE + ci, // 与叶 id 分段，onMarkerTap 据此区分簇展开 / 叶弹窗
          latitude: c.latitude,
          longitude: c.longitude,
          width: CLUSTER_BUBBLE_SIZE,
          height: CLUSTER_BUBBLE_SIZE,
          anchor: { x: 0.5, y: 0.5 },
        };
        if (icons[ci]) {
          marker.iconPath = icons[ci];
        } else {
          // 离屏 canvas 不可用：退回默认点 + 常显数字气泡，聚合仍可读（点击走 bindcallouttap，见 wxml）
          marker.iconPath = '/assets/icons/marker-dot.png';
          marker.callout = { content: String(c.count), color: CLUSTER_TEXT_COLOR, fontSize: 12, bgColor: CLUSTER_BG_COLOR, borderRadius: 10, padding: 6, display: 'ALWAYS', textAlign: 'center' };
        }
        return marker;
      });
      this._clusters = clusters; // 与 markers 同一提交点更新：簇下标 ci 必须和屏上气泡对齐
      // 视野与 markers 同一次 setData 交给 <map>：静默窗口和聚合 zoom 都从这一刻起算——
      // 上面守卫里被作废的过期构建根本走不到这一行，故不会再留下一个「视野没落地却已生效」的孤儿 _gridZoom，
      // 去喂后续 gridCluster 的分格与 expandCluster 的封顶判定
      if (patch.center) {
        this._gridZoom = patch.scale;
        this._progCamUntil = Date.now() + PROGRAMMATIC_CAMERA_MS;
      }
      this.setData(Object.assign({ markers }, patch));
    });
  },

  /** map 渲染完成钩子：声明式 markers 在节点挂载时自动生效，无需命令式补投；保留仅为观测/兜底 */
  onMapLoad() {},

  /** 视野变化结束时按当前缩放重建聚合分级（跨端字段不一致，取不到用 getScale / getCenterLocation 兜底） */
  onRegionChange(e) {
    const d = (e && e.detail) || {};
    const type = (e && e.type) || d.type;
    if (type !== 'end') return;
    if (Date.now() < (this._progCamUntil || 0)) return; // 程序改视野（fit/expand）的静默窗口：期间不回读，避免自激重建
    // 回写 data.scale + data.center，一次 setData，两者缺一不可：
    // · scale：s 是用户手势结束后相机真实所在的层级（regionchange end 回读值）。不回写的话 data.scale
    //   会停在 fit/expand 的旧值：从封顶 20 级双指缩小后 expandCluster 读到的还是 20 → 点任何簇都误弹成员半屏，
    //   且地图⇄列表往返把 <map> 重建时也会按这个陈旧值重设视野。
    // · center：scale 属性回写会连带把相机重置到「当前绑定的 center」上（track-map 实测教训，
    //   见 components/track-map/track-map.js applyOverviewScale 的注释与 getCenterLocation 兜底），
    //   所以只写 scale = 手势一结束视野就被弹回 fit/expand 留下的旧中心。必须把回读到的当前中心配套写回。
    const commit = (s, center) => {
      // 这里复校的只有「层级几乎没变」这一种提交（异步取中心期间 data.scale/_gridZoom 可能已被对齐到新值）；
      // 「谁的先后」不在这里判——见下面 apply 的相机写序令牌
      if (Math.abs(s - (this._gridZoom || this.data.scale)) < 0.5) return;
      this._gridZoom = s;
      this.setData({ scale: s, center });
      this.buildMarkers({ fit: false });
    };
    const apply = (raw, center) => {
      const s = Number(raw);
      if (!Number.isFinite(s)) return;
      if (Math.abs(s - (this._gridZoom || this.data.scale)) < 0.5) return; // 先按层级闸门，纯平移/微抖不必去异步取中心
      // 相机写序令牌：中心要异步问，问回来之前可能又并进一次（甚至两次）手势，
      // 只有最后取号那次有权写相机——否则早先那次会带着「已不属于当前视野」的 scale+中心把镜头拽走，
      // 而 commit 的 <0.5 复校看不见次序（8 与 12 差得远，挡不住）
      const tok = (this._camWriteSeq = (this._camWriteSeq || 0) + 1);
      // 注意用 NaN 兜底判空：Number(null) 是 0，直接 Number(center && center.latitude) 会把「没有中心」当成 0 纬度
      const lat = center ? Number(center.latitude) : NaN;
      const lng = center ? Number(center.longitude) : NaN;
      if (Number.isFinite(lat) && Number.isFinite(lng)) return commit(s, { latitude: lat, longitude: lng });
      // 事件不带中心点（各端字段不一致）：先异步问相机现在到底在哪，问出来之前不回写 scale。
      // 中心问不到（端上无 getCenterLocation / 回读 fail）时也不再整条放弃，降级为「无相机」提交：
      // 只同步聚合层级 + 重建分桶，一个相机属性都不 setData。
      // 为什么不裸写 scale：scale 一改，<map> 就把相机重置到当前绑定的 center 上（track-map 实测教训，
      // 见 components/track-map/track-map.js applyOverviewScale），而 center 恰恰是这次问不到的值 → 必然弹回旧视野。
      // fit:false 的 patch 是空的，buildMarkers 只换 markers，视野原地不动，也就没有弹回可言。
      const degrade = () => {
        this._gridZoom = s;
        this.buildMarkers({ fit: false });
      };
      const ctx = wx.createMapContext(MAP_ID, this);
      if (!ctx.getCenterLocation) return degrade();
      ctx.getCenterLocation({
        success: (loc) => {
          // 令牌已被更晚的手势取走，或这中间 expandCluster/fit 把相机程序化挪走了（静默窗口未到）：
          // 这次读到的中心不再属于当前视野，写回会把镜头拽去别处，整次丢弃
          if (tok !== this._camWriteSeq || Date.now() < (this._progCamUntil || 0)) return;
          const cLat = loc ? Number(loc.latitude) : NaN;
          const cLng = loc ? Number(loc.longitude) : NaN;
          if (Number.isFinite(cLat) && Number.isFinite(cLng)) commit(s, { latitude: cLat, longitude: cLng });
        },
        fail: () => degrade(),
      });
    };
    const raw = Number.isFinite(e.scale) ? e.scale : Number.isFinite(d.scale) ? d.scale : null;
    const center = e.centerLocation || d.centerLocation || null;
    if (raw != null) return apply(raw, center);
    const ctx = wx.createMapContext(MAP_ID, this);
    if (ctx.getScale) ctx.getScale({ success: (r) => apply(r && r.scale, center), fail: () => {} });
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
  /**
   * 点簇气泡：向簇心放大 EXPAND_ZOOM_STEP 级（等效原生 zoomOnClick 的展开语义）。
   * 已到 scale 上限仍并簇（同坐标点本地网格拆不开）→ 成员半屏列表兜底（fix 轮留存的 clusterSheet）。
   */
  expandCluster(idx) {
    const c = (this._clusters || [])[idx];
    if (!c) return;
    // 不再 Math.max(_gridZoom, data.scale)：onRegionChange 已把手势缩放回写进 data.scale，
    // 两者现在同源，取其一即可（Math.max 会把封顶值永久留在 base 上，误判「已到底」）
    const base = this._gridZoom || this.data.scale;
    if (base >= MAX_SCALE - 0.5) {
      const recs = (c.members || []).map((i) => this.data.records[i]).filter(Boolean);
      if (recs.length) this.showClusterMembers(recs);
      else console.warn('[footprints] expandCluster: 封顶簇无有效成员，_clusters 与 records 已脱节 idx=' + idx + ' count=' + c.count);
      return;
    }
    const next = Math.min(MAX_SCALE, base + EXPAND_ZOOM_STEP);
    this._gridZoom = next;
    this._progCamUntil = Date.now() + PROGRAMMATIC_CAMERA_MS;
    this.setData({ center: { latitude: c.latitude, longitude: c.longitude }, scale: next });
    this.buildMarkers({ fit: false });
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

  /** 切换形态：map 节点被 wx:if 销毁/重建时声明式 markers 自动重挂，无需任何补投 */
  switchMode(e) { this.setData({ mode: e.currentTarget.dataset.mode }); },
  openAdd() { wx.navigateTo({ url: '/packageFootRecords/pages/record-edit/record-edit' }); },
  noop() {},
});

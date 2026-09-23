// 足迹 tab 主页：全屏地图（本地网格聚合 + 自绘小圆气泡 marker）+ 详情/表单半屏；
// 浮层只留 筛选 / 搜索 / 图层 / 列表 / 新增 五个入口（统计页入口在列表页顶部栏），本页只负责地图与聚合。
const api = require('../../services/api');
const geo = require('../../utils/footprint-geo');
const config = require('../../config/index');
const ffilter = require('../../utils/footprint-filter');

/** 分类 chips 与候选项的展示顺序跟着 config 的分类盘走 */
const CATEGORY_KEYS = config.FOOTPRINT_CATEGORIES.map((c) => c.key);
/** 分类图标的 marker 显示尺寸（CSS px）：白圆底比原来的 18px 圆点大一档，字形才认得出 */
const CAT_MARKER_SIZE = 26;

const MAP_ID = 'footprintMap';
/** 图层选择的本地存储 key：足迹地图常看同一档，切一次就该记住（命名口径同 tracks 页的 VIEW_MODE_KEY） */
const MAP_LAYER_KEY = 'footprint_map_layer';
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

/** —— 有图单点的照片卡 marker（离屏 canvas 合成"cover 裁切图 + 标题条"整卡出图）——
 * 不用 cover-image 原因：customCallout 里 cover-image 的 mode 在开发者工具被忽略（scaleToFill 拉伸变形），
 * 离屏 canvas 自己做 cover 裁切全端一致。尺寸 CSS px，画布 ×2 保清晰 */
const CARD_W = 108;
const CARD_IMG_H = 64;
const CARD_TITLE_H = 22;
const CARD_H = CARD_IMG_H + CARD_TITLE_H;
const PHOTO_ICON_CACHE = {};
/** 单点气泡分档阈值：scale ≥9 有图出照片卡；scale ≥7 全部出标题胶囊；<7 只显示定位圆点。
 *  缩放跨档时 regionchange 触发重建，气泡随之自动出现/移除 */
const PILL_MIN_SCALE = 7;
const PHOTO_CARD_MIN_SCALE = 9;

/** 圆角矩形路径 */
function cardRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 画有图单点的照片卡 marker：图 cover 裁切不变形 + 白底标题条（单行超长省略）；失败返回 '' 走标题胶囊兜底 */
function buildPhotoCardIcon(record) {
  const key = 'fp-photo-' + record.id;
  if (PHOTO_ICON_CACHE[key]) return Promise.resolve(PHOTO_ICON_CACHE[key]);
  return new Promise((resolve) => {
    try {
      const W = CARD_W * 2;
      const H = CARD_H * 2;
      const imgH = CARD_IMG_H * 2;
      const canvas = wx.createOffscreenCanvas({ type: '2d', width: W, height: H });
      const ctx = canvas.getContext('2d');
      const img = canvas.createImage();
      img.onload = () => {
        try {
          cardRoundRect(ctx, 0, 0, W, H, 16);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          // 图片区：cover 裁切（等比缩放后居中裁满，绝不拉伸）
          ctx.save();
          cardRoundRect(ctx, 0, 0, W, imgH, 16);
          ctx.clip();
          const s = Math.max(W / img.width, imgH / img.height);
          const sw = W / s;
          const sh = imgH / s;
          ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, W, imgH);
          ctx.restore();
          // 标题：单行居中，超长截断加省略号
          ctx.font = '22px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          let t = record.title || '';
          const full = t;
          while (t && ctx.measureText(t).width > W - 20) t = t.slice(0, -1);
          if (t !== full) t += '…';
          ctx.fillStyle = '#1f2329';
          ctx.fillText(t, W / 2, imgH + CARD_TITLE_H);
          wx.canvasToTempFilePath({
            canvas,
            success: (r) => resolve(r.tempFilePath),
            fail: () => resolve(''),
          });
        } catch (e) {
          resolve('');
        }
      };
      img.onerror = () => resolve('');
      img.src = record.coverPhotoThumb;
    } catch (e) {
      resolve('');
    }
  }).then((path) => {
    if (path) PHOTO_ICON_CACHE[key] = path;
    return path;
  });
}

/** 地图可视区（CSS px）：整页即地图（全屏），tabBar 不占 windowHeight */
function mapViewport() {
  const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  const width = (info && info.windowWidth) || 375;
  const height = (info && info.windowHeight) || 600;
  return { width, height: Math.max(200, height) };
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

/**
 * 无匹配结果的 toast 文案：带关键词就点名该词（超 10 字截断，toast 标题两行就顶到导航栏），
 * 只有省/年/分类筛选时说「当前筛选」——两种情况用户能取消的入口不一样。
 */
function noMatchToast(keyword) {
  const kw = (keyword || '').trim();
  if (!kw) return '没有符合当前筛选的足迹';
  return `没有匹配「${kw.length > 10 ? `${kw.slice(0, 10)}…` : kw}」的足迹`;
}

/**
 * 读回上次的图层：只认 satellite 这一个存值，其余（没存过 / 存坏 / 读失败）一律标准图。
 * storage 读失败不能拖垮进页——地图页唯一的入口就是它自己。
 */
function readLayer() {
  try {
    return wx.getStorageSync(MAP_LAYER_KEY) === 'satellite' ? 'satellite' : 'standard';
  } catch (e) {
    return 'standard';
  }
}

Page({
  data: {
    loading: true,
    error: '',
    records: [], // 当前展示的点集（可能已被筛选/搜索过滤）：/geo item
    options: { provinces: [], years: [], categories: [] }, // 筛选弹窗的候选，来自未过滤快照
    filter: { province: '', year: '', category: '' }, // 已生效的筛选（弹窗点确定才写这里）
    filterCount: 0, // 生效项数，驱动筛选按钮角标
    filterVisible: false,
    keywordInput: '', // 输入框里的值（未提交）
    keyword: '', // 已提交的关键词：回车/点搜索才生效，与列表页同一套双态
    searchOpen: false,
    searchFocus: false,
    markers: [], // 本地网格聚合产物：叶 marker + 自绘簇气泡 marker，声明式绑给 <map>
    callouts: [], // 叶照片卡内容（有 coverPhoto 的单点），配合 map 的 customCallout slot
    center: { latitude: 30.5, longitude: 114.3 }, // 视野由 fitBounds 覆盖，这里只是无数据时的兜底
    scale: 12,
    mapType: 'standard', // 底图图层：standard / satellite，翻给 <map> 的 enable-satellite
    detailVisible: false, // 详情半屏（components/footprint-detail）
    detailRecord: null, // 轻量 DTO 即可，缺字段由组件补拉
    clusterSheet: { visible: false, records: [] }, // 最大缩放兜底：同处多条足迹的成员列表
    formVisible: false, // 新增/编辑半屏表单（components/footprint-form）
    formRecord: null, // 传入记录即为编辑态
  },
  onLoad() {
    // 首帧渲染前把图层读回来：写在 data 字面量里只能给默认值，读库必须赶在 onLoad
    this.setData({ mapType: readLayer() });
    this.loadAll();
  },

  /** 标准 ⇄ 卫星：切的是底图，数据与聚合一律不重建（重建会让 marker 闪一下） */
  toggleLayer() {
    const mapType = this.data.mapType === 'satellite' ? 'standard' : 'satellite';
    try {
      wx.setStorageSync(MAP_LAYER_KEY, mapType);
    } catch (e) {
      // 写失败只是下次进页回到标准档，不值得打断这次切换
    }
    this.setData({ mapType });
  },

  async loadAll() {
    // 请求序号守卫：只应用最后一次结果，防竞态
    const seq = (this._seq = (this._seq || 0) + 1);
    // 仅首屏才进 loading 态；刷新保留已渲染内容，防闪屏
    const firstLoad = this.data.records.length === 0;
    this.setData(firstLoad ? { loading: true, error: '' } : { error: '' });
    const q = ffilter.buildGeoQuery(Object.assign({}, this.data.filter, { keyword: this.data.keyword }));
    const plain = Object.keys(q).length === 0;
    try {
      // 筛选态下多拉一次全量：候选项（省份/年份/分类）必须来自未过滤快照，
      // 否则选中的省份会在候选里消失、没法改回去。只在进页/刷新/增删改后发生，切筛选不重复拉。
      const [shown, all] = await Promise.all([this.fetchGeo(q), plain ? null : this.fetchGeo({})]);
      if (seq !== this._seq) return;
      const snapshot = plain ? shown.items : (all || shown).items;
      this.setData({
        loading: false,
        records: shown.items,
        options: ffilter.buildFilterOptions(snapshot, CATEGORY_KEYS),
        filterCount: ffilter.activeFilterCount(this.data.filter),
      });
      // 查不到只 toast，不在地图上摆浮层文本；空白账号（无筛选无关键词）不走这里，留给地图上的新增引导
      if (shown.items.length === 0 && !plain) wx.showToast({ title: noMatchToast(this.data.keyword), icon: 'none' });
      // return 出去：markers 与 loading:false 落在同一帧（否则首屏会先闪一帧无 marker 的空图）
      return this.buildMarkers();
    } catch (e) {
      if (seq !== this._seq) return;
      this.setData({ loading: false });
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
  fetchGeo(query) {
    return api.get('/footprint-records/geo', query);
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

    // 一次构建内按 distinct count 出图（簇）+ 按 distinct record 出图（有图叶点的照片卡）。
    // 每个图标任务都套 4s 超时：离屏 canvas 图片加载可能既不 onload 也不 onerror，
    // 不兜底会卡死 Promise.all → 整张地图一个 marker 都不出（实测教训）
    const timeout = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r(''), 4000))]);
    const iconJobs = new Map();
    const photoJobs = new Map();
    clusters.forEach((c) => {
      if (c.count > 1) {
        if (!iconJobs.has(c.count)) iconJobs.set(c.count, timeout(buildClusterIcon(c.count)));
      } else if (zoom >= PHOTO_CARD_MIN_SCALE) {
        const r = records[c.recordIndex] || {};
        if (r.coverPhotoThumb && !photoJobs.has(r.id)) photoJobs.set(r.id, timeout(buildPhotoCardIcon(r)));
      }
    });
    const callouts = []; // 无图叶点的标题胶囊 customCallout 内容（marker-id 定位，wxml slot 渲染）

    const iconKeys = [...iconJobs.keys()];
    const photoKeys = [...photoJobs.keys()];
    return Promise.all([...iconJobs.values(), ...photoJobs.values()]).then((vals) => {
      // 被后续构建/刷新取代：既不 setData，也不覆盖 _clusters（否则 expandCluster 会按陈旧桶开错记录）
      if (seq !== this._seq || build !== this._buildSeq || records !== this.data.records) return;
      // Promise.all 的解包值按提交顺序还原：前段=簇图标，后段=照片卡图标
      const iconPathByCount = new Map(iconKeys.map((k, i) => [k, vals[i]]));
      const photoPathById = new Map(photoKeys.map((k, i) => [k, vals[iconKeys.length + i]]));
      const markers = clusters.map((c, ci) => {
        if (c.count === 1) {
          // 稀疏点装饰分档：scale ≥9 有图出照片卡；scale ≥7 出标题胶囊；<7 只显示定位圆点
          const r = records[c.recordIndex] || {};
          const leaf = {
            id: c.recordIndex + 1,
            latitude: c.latitude,
            longitude: c.longitude,
            iconPath: '/assets/icons/marker-dot.png',
            width: 18,
            height: 18,
            anchor: { x: 0.5, y: 0.5 },
          };
          const photoPath = zoom >= PHOTO_CARD_MIN_SCALE && r.coverPhotoThumb ? photoPathById.get(r.id) : '';
          if (photoPath) {
            leaf.iconPath = photoPath;
            leaf.width = CARD_W;
            leaf.height = CARD_H;
            leaf.anchor = { x: 0.5, y: 1 }; // 卡片底部尖端对准坐标
          } else {
            // 分类图标（白圆底）优先于灰色圆点；未分类/未知 key 走 footprintCategoryIcon 的空串兜底
            const catIcon = config.footprintCategoryIcon(r.category, true);
            if (catIcon) {
              leaf.iconPath = catIcon;
              leaf.width = CAT_MARKER_SIZE;
              leaf.height = CAT_MARKER_SIZE;
            }
            if (zoom >= PILL_MIN_SCALE) {
              leaf.customCallout = { display: 'ALWAYS' };
              callouts.push({ id: leaf.id, title: r.title || '' });
            }
          }
          return leaf;
        }
        const marker = {
          id: CLUSTER_ID_BASE + ci, // 与叶 id 分段，onMarkerTap 据此区分簇展开 / 叶弹窗
          latitude: c.latitude,
          longitude: c.longitude,
          width: CLUSTER_BUBBLE_SIZE,
          height: CLUSTER_BUBBLE_SIZE,
          anchor: { x: 0.5, y: 0.5 },
        };
        const icon = iconPathByCount.get(c.count);
        if (icon) {
          marker.iconPath = icon;
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
      this.setData(Object.assign({ markers, callouts }, patch));
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
    if (r) this.openDetail(r);
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
    if (r) this.openDetail(r);
  },

  /** 详情半屏：轻量 DTO 直接交给组件（缺字段由组件补拉 GET /:id，seq 守卫在组件内） */
  openDetail(record) {
    if (!record) return;
    this.setData({ detailVisible: true, detailRecord: record });
  },
  closeDetail() { this.setData({ detailVisible: false, detailRecord: null }); },
  /** 详情里点「编辑」：关详情、带完整记录就地开表单 */
  onDetailEdit(e) {
    this.setData({ detailVisible: false, detailRecord: null, formVisible: true, formRecord: e.detail });
  },
  /** 详情里删除成功：关详情并整页刷新 */
  onDetailDeleted() {
    this.setData({ detailVisible: false, detailRecord: null });
    this.loadAll();
  },

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
    if (r) this.openDetail(r);
  },

  /** 全屏地图上的浮层入口：列表页（统计入口在列表页顶部栏） */
  goList() { wx.navigateTo({ url: '/pages/footprint-list/footprint-list' }); },
  openAdd() { this.setData({ formVisible: true, formRecord: null }); },
  closeForm() { this.setData({ formVisible: false, formRecord: null }); },
  /** 表单保存成功：关弹层 + 重拉地图数据（列表页数据在其自身页面内加载） */
  onFormSaved() {
    this.setData({ formVisible: false, formRecord: null });
    this.loadAll();
  },
  /** —— 筛选半屏（省份/年份/分类，候选来自未过滤快照）—— */
  openFilter() { this.setData({ filterVisible: true }); },
  closeFilter() { this.setData({ filterVisible: false }); },
  onFilterConfirm(e) {
    this.setData({
      filterVisible: false,
      filter: Object.assign({ province: '', year: '', category: '' }, e.detail),
    });
    this.loadAll();
  },

  /** —— 搜索：右上按钮向左展开成输入框；回车才生效（与列表页同一套 keywordInput/keyword 双态）—— */
  toggleSearch() {
    if (this.data.searchOpen) this.setData({ searchOpen: false, searchFocus: false });
    else this.setData({ searchOpen: true, searchFocus: true, keywordInput: this.data.keyword });
  },
  onKeywordInput(e) { this.setData({ keywordInput: e.detail.value }); },
  onSearchConfirm() {
    const kw = (this.data.keywordInput || '').trim();
    if (kw === this.data.keyword) return; // 没改词就不必重拉
    this.setData({ keyword: kw });
    this.loadAll();
  },
  /** ✕：清掉关键词并收起输入框（点 X 就该整条收回，不必再点一次放大镜）；框本来就空时只收起 */
  onClearKeyword() {
    const had = !!(this.data.keywordInput || this.data.keyword);
    this.setData({ keywordInput: '', keyword: '', searchOpen: false, searchFocus: false });
    if (had) this.loadAll();
  },

  noop() {},
});

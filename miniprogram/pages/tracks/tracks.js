const api = require('../../services/api');
const { formatThousands } = require('../../utils/format');
const { getBestCache, setBestCache } = require('../../services/storage');
const { matchBest } = require('../../utils/best-records');
const config = require('../../config/index');
const { markHomeDirty } = require('../../utils/home-refresh');
const { buildMapView, visibleMapIds } = require('../../utils/map-preview');

const PAGE_SIZE = 20;
const VIEW_MODE_KEY = 'tracksViewMode';
const pad2 = (n) => String(n).padStart(2, '0');

/** 秒 → h:mm:ss（月度统计用） */
function formatHms(seconds) {
  const s = Math.round(seconds || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** 月度汇总：累计 + 平均（次数仅累计） */
function buildMonthStats(count, distanceM, durationS, kcal) {
  const km = (v) => (Math.round(v / 10) / 100).toFixed(2);
  return {
    count,
    distanceKm: km(distanceM),
    timeText: formatHms(durationS),
    kcalText: formatThousands(kcal),
    avgDistanceKm: count ? km(distanceM / count) : '0.00',
    avgTimeText: count ? formatHms(durationS / count) : '0:00:00',
    avgKcalText: count ? formatThousands(kcal / count) : '0',
  };
}

/** 月度聚合映射合并：列表响应附带的月份全量聚合并入 map（key '2026-9' → 聚合行） */
function mergeMonthly(map, rows) {
  const out = { ...map };
  (rows || []).forEach((m) => { out[`${m.year}-${m.month}`] = m; });
  return out;
}

Page({
  data: {
    filters: [{ type: '', label: '全部' }].concat(
      config.ACTIVITY_TYPES.map((t) => ({ type: t.type, label: t.label })),
    ),
    activeFilter: '',
    provinceFilter: '', // 省份筛选（足迹地图跳转带入）
    rangeFilter: null, // 精确时间范围（报告页日期汇总下钻带入）：{ from, to, label }
    viewMode: 'list', // 展示模式：list 单行列表（默认，按月分组）/ grid 地图（一行一条：左地图右概况）
    items: [],
    totalCount: 0, // 当前筛选命中的总条数（接口 total，非已加载条数）
    groups: [], // 列表模式按月分组：[{ key: '2026-9', label: '2026年9月', items }]
    page: 1,
    hasMore: true,
    loading: false,
    initialized: false,
    loadError: false, // 首屏加载失败（与「还没有运动记录」区分，展示重试入口）
  },

  onLoad() {
    // 记忆用户上次的展示模式选择
    try {
      const saved = wx.getStorageSync(VIEW_MODE_KEY);
      if (saved === 'grid' || saved === 'list') this.setData({ viewMode: saved });
    } catch (e) {}
  },

  /** 切换展示模式（lucide layout-list / layout-grid 图标按钮） */
  onToggleMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (!mode || mode === this.data.viewMode) return;
    this.setData({ viewMode: mode });
    try {
      wx.setStorageSync(VIEW_MODE_KEY, mode);
    } catch (err) {}
    this.scheduleMapSync();
  },

  /**
   * 地图模式：卡片进入视口（上下各留 240px）才挂载原生 map 并拉抽稀点。
   * 20 行同时挂 map 太重；离开视野后卸载地图节点（点数据留在 items 里，回来即挂）。
   * 用页面滚动 + boundingClientRect 同步（多节点 IntersectionObserver 实测只回调首行）。
   */
  scheduleMapSync(delay = 60) {
    if (this.data.viewMode !== 'grid') {
      this.clearMapTimers();
      this.unmountMaps();
      return;
    }
    if (this._mapSyncTimer) clearTimeout(this._mapSyncTimer);
    this._mapSyncTimer = setTimeout(() => {
      this._mapSyncTimer = null;
      this.syncVisibleMaps();
    }, delay);
  },

  syncVisibleMaps() {
    if (this.data.viewMode !== 'grid' || !wx.createSelectorQuery) return;
    wx.createSelectorQuery()
      .in(this)
      .selectAll('.map-item')
      .boundingClientRect((rects) => {
        const info = wx.getWindowInfo
          ? wx.getWindowInfo()
          : wx.getSystemInfoSync
            ? wx.getSystemInfoSync()
            : {};
        const ids = visibleMapIds(rects, info.windowHeight || 667, 240);
        const patch = {};
        let changed = false;
        this.data.items.forEach((item, idx) => {
          if (ids.has(item.id)) {
            if (!item.mapReady && item.mapCenter) {
              patch[`items[${idx}].mapReady`] = true;
              changed = true;
              if (item.mapFitPoints && item.mapFitPoints.length) this.fitItemMap(item.id);
            }
            this.loadItemMap(item.id);
          } else if (item.mapReady) {
            patch[`items[${idx}].mapReady`] = false;
            changed = true;
          }
        });
        if (changed) this.setData(patch);
      })
      .exec();
  },

  /** 滚动节流：120ms 内只同步一次可视行 */
  onPageScroll() {
    if (this.data.viewMode !== 'grid' || this._mapScrollTimer) return;
    this._mapScrollTimer = setTimeout(() => {
      this._mapScrollTimer = null;
      this.syncVisibleMaps();
    }, 120);
  },

  clearMapTimers() {
    if (this._mapSyncTimer) {
      clearTimeout(this._mapSyncTimer);
      this._mapSyncTimer = null;
    }
    if (this._mapScrollTimer) {
      clearTimeout(this._mapScrollTimer);
      this._mapScrollTimer = null;
    }
  },

  /** 地图从视野外回收：避免来回切模式时一次性挂满 20 个 map */
  unmountMaps() {
    if (!this.data.items.some((i) => i.mapReady)) return;
    const patch = {};
    this.data.items.forEach((it, idx) => {
      if (it.mapReady) patch[`items[${idx}].mapReady`] = false;
    });
    this.setData(patch);
  },

  async loadItemMap(id) {
    const item = this.data.items.find((i) => i.id === id);
    if (!item || item.mapDetail || item.mapLoading || item.mapFailed) return;
    this._mapCache = this._mapCache || {};
    if (Object.prototype.hasOwnProperty.call(this._mapCache, id)) {
      this.applyItemMap(id, this._mapCache[id]);
      return;
    }
    this.updateItem(id, { mapLoading: true });
    try {
      const data = await api.get(`/activities/${id}/map-points`);
      const view = buildMapView((data && data.points) || [], item.type);
      this._mapCache[id] = view;
      this.applyItemMap(id, view);
    } catch (e) {
      this.updateItem(id, { mapLoading: false, mapFailed: true });
    }
  },

  applyItemMap(id, view) {
    if (!view) {
      this.updateItem(id, { mapLoading: false, mapDetail: true, mapEmpty: true });
      return;
    }
    this.updateItem(id, {
      mapLoading: false,
      mapDetail: true,
      mapFailed: false,
      mapEmpty: false,
      mapReady: true,
      mapPolyline: view.polyline,
      mapIncludePoints: view.includePoints,
      mapFitPoints: view.fitPoints,
      mapCenter: view.center,
    });
    this.fitItemMap(id);
  },

  /**
   * 主动把轨迹包进地图视野并留 12px 边距：
   * 属性 include-points 只能紧贴边，轨迹会顶到圆角/版权字上；MapContext 的 padding 才稳。
   */
  fitItemMap(id) {
    if (!wx.createMapContext) return;
    setTimeout(() => {
      const item = this.data.items.find((i) => i.id === id);
      if (!item || !item.mapReady || !item.mapFitPoints || !item.mapFitPoints.length) return;
      try {
        const ctx = wx.createMapContext(`track-map-${id}`, this);
        if (ctx && ctx.includePoints) {
          ctx.includePoints({ points: item.mapFitPoints, padding: [12, 12, 12, 12] });
        }
      } catch (e) {}
    }, 60);
  },

  /** 单行更新（路径 setData）：地图点返回时不重渲染整页与其它 map */
  updateItem(id, patch) {
    const idx = this.data.items.findIndex((i) => i.id === id);
    if (idx < 0) return;
    const data = {};
    Object.keys(patch).forEach((k) => {
      data[`items[${idx}].${k}`] = patch[k];
    });
    this.setData(data);
  },

  onShow() {
    const app = getApp();
    // 报告页「日期汇总」下钻：tab 页不能带参，经 globalData 传精确时间范围
    if (app.globalData.pendingTracksRange) {
      const range = app.globalData.pendingTracksRange;
      app.globalData.pendingTracksRange = null;
      const from = Number(range && range.from);
      const to = Number(range && range.to);
      if (Number.isFinite(from) && Number.isFinite(to) && to > from) {
        this.setData({
          rangeFilter: { from, to, label: (range && range.label) || '指定时间' },
          page: 1,
          items: [],
          hasMore: true,
        });
        this.refresh();
        return;
      }
    }
    // 足迹地图"查看该省轨迹"入口：tab 页不能带参，经 globalData 传递
    if (app.globalData.pendingTracksProvince) {
      const province = app.globalData.pendingTracksProvince;
      app.globalData.pendingTracksProvince = '';
      this.setData({ provinceFilter: province, page: 1, items: [], hasMore: true });
      this.refresh();
      return;
    }
    // 保存完新运动后跳转回来：强制拉取最新数据（switchTab 无法带参，走 globalData 标记）
    if (app.globalData.tracksNeedRefresh) {
      app.globalData.tracksNeedRefresh = false;
      this.setData({ page: 1, items: [], hasMore: true });
      this.refresh();
      return;
    }
    if (!this.data.initialized) {
      this.refresh();
    } else {
      this.scheduleMapSync();
    }
  },

  onHide() {
    this.clearMapTimers();
    this.unmountMaps();
  },

  onUnload() {
    this.clearMapTimers();
  },

  /** 清除省份筛选 */
  clearProvince() {
    this.setData({ provinceFilter: '', page: 1, items: [], hasMore: true });
    this.refresh();
  },

  /** 清掉报告页带入的时间范围，回到默认列表 */
  clearRange() {
    this.setData({ rangeFilter: null, page: 1, items: [], hasMore: true });
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh());
  },

  /** 首屏加载失败后的重试入口 */
  onRetryLoad() {
    if (this.data.loading) return;
    this.refresh();
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) {
      this.loadMore();
    }
  },

  /** 切换类型筛选（t-tabs） */
  onTabChange(e) {
    const type = e.detail.value;
    if (type === this.data.activeFilter) return;
    this.setData({ activeFilter: type, page: 1, items: [], hasMore: true });
    this.refresh();
  },

  async refresh() {
    const app = getApp();
    // 已注册用户（本地有 token）静默恢复登录；游客不自动登录
    if (app.hasSession() && !app.globalData.loggedIn) {
      try {
        await app.login();
      } catch (e) {
        console.warn('静默登录失败', e);
      }
    }
    if (!app.globalData.loggedIn) return;
    try {
      this._monthlyStats = {}; // 重置聚合缓存，防上一次筛选的数据串味（只在 JS 用，不进 data）
      this._mapCache = {}; // 地图抽稀点缓存随列表刷新一起作废
      this.setData({ loading: true, page: 1 });
      // 个人最佳与列表并行拉取：每次刷新都取实时值（缓存不失效，新纪录要立刻在卡片亮出）
      const [data, best] = await Promise.all([api.get('/activities', this.buildParams(1)), this.loadBest()]);
      this._best = best;
      const items = data.items.map((it) => this.decorate(it, best));
      const monthly = mergeMonthly({}, data.monthlyStats);
      this._monthlyStats = monthly; // 列表响应附带页内月份的全量聚合
      this.setData({
        items,
        totalCount: data.total || 0,
        groups: this.buildGroups(items, monthly),
        hasMore: data.items.length >= PAGE_SIZE,
        initialized: true,
        loadError: false,
      });
      this.scheduleMapSync();
    } catch (e) {
      console.error('加载轨迹列表失败', e);
      this.setData({ loadError: true });
    } finally {
      this.setData({ loading: false });
    }
  },

  /** 删除轨迹后重拉整月聚合（/stats/activity-monthly）；常规路径的聚合由列表响应附带 */
  async syncMonthlyStats() {
    const type = this.data.activeFilter;
    if (!type) return;
    try {
      const data = await api.get('/stats/activity-monthly', { type });
      if (this.data.activeFilter !== type) return; // 期间已切换筛选，丢弃过期响应
      const map = {};
      (data.months || []).forEach((m) => { map[`${m.year}-${m.month}`] = m; });
      this._monthlyStats = map;
      this.setData({ groups: this.buildGroups(this.data.items, map) });
    } catch (e) {
      console.warn('月度统计拉取失败', e); // 静默：统计块沿用已加载条目的汇总
    }
  },

  /** 拉取个人最佳（/stats/best），成功后回写本地缓存供详情页等复用；失败返回 null（卡片不亮徽章） */
  async loadBest() {
    const app = getApp();
    const uid = app.globalData.user ? app.globalData.user.id : '';
    try {
      const best = await api.get('/stats/best');
      if (best) setBestCache(uid, best);
      return best || null;
    } catch (e) {
      return getBestCache(uid); // 实时拉取失败退回缓存，角标宁可有旧数据也不闪没
    }
  },

  async loadMore() {
    const next = this.data.page + 1;
    try {
      this.setData({ loading: true });
      const data = await api.get('/activities', this.buildParams(next));
      const items = this.data.items.concat(data.items.map((it) => this.decorate(it, this._best)));
      const monthly = mergeMonthly(this._monthlyStats, data.monthlyStats); // 新出现月份增量并入
      this._monthlyStats = monthly;
      this.setData({
        items,
        totalCount: data.total || 0,
        groups: this.buildGroups(items, monthly),
        page: next,
        hasMore: data.items.length >= PAGE_SIZE,
      });
      this.scheduleMapSync();
    } catch (e) {
      console.error('加载更多失败', e);
    } finally {
      this.setData({ loading: false });
    }
  },

  /** 列表模式按月分组：items 时间倒序，依次归入「YYYY年M月」组（分页/删除后全量重建）；
   *  每组附带当月统计，优先用后端整月聚合（monthly 参数），未命中时回退到已加载条目的汇总 */
  buildGroups(items, monthly = this._monthlyStats || {}) {
    const groups = [];
    const byKey = new Map();
    for (const item of items) {
      const d = new Date(item.startTime);
      const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
      let group = byKey.get(key);
      if (!group) {
        group = {
          key,
          label: `${d.getFullYear()}年${d.getMonth() + 1}月`,
          items: [],
          _count: 0,
          _distance: 0,
          _duration: 0,
          _kcal: 0,
        };
        byKey.set(key, group);
        groups.push(group);
      }
      group.items.push(item);
      group._count += 1;
      group._distance += item.distance || 0;
      group._duration += item.duration || 0;
      group._kcal += item.calories || 0;
    }
    for (const g of groups) {
      const m = monthly[g.key];
      g.stats = m
        ? buildMonthStats(m.count, m.distance, m.duration, m.calories)
        : buildMonthStats(g._count, g._distance, g._duration, g._kcal);
      delete g._count;
      delete g._distance;
      delete g._duration;
      delete g._kcal;
    }
    return groups;
  },

  /** 构造查询参数：空筛选不传 type（后端 enum 校验不接受空串） */
  buildParams(page) {
    const params = { page, pageSize: PAGE_SIZE };
    if (this.data.activeFilter) {
      params.type = this.data.activeFilter;
    }
    if (this.data.provinceFilter) {
      params.province = this.data.provinceFilter;
    }
    if (this.data.rangeFilter) {
      params.from = this.data.rangeFilter.from;
      params.to = this.data.rangeFilter.to;
    }
    return params;
  },

  /** 列表项装饰：原始聚合数据 → 展示字段（后端返回 _id，补 id 映射） */
  decorate(item, best) {
    const meta = config.ACTIVITY_TYPES.find((t) => t.type === item.type) || {};
    const start = new Date(item.startTime);
    // 时间展示：一周内显示星期几，超过一周显示年月日
    const diffDays = Math.floor((Date.now() - start.getTime()) / 86400000);
    const timeText =
      diffDays < 7
        ? ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][start.getDay()]
        : `${start.getFullYear()}/${start.getMonth() + 1}/${start.getDate()}`;
    // 列表地图模式：先用 60 点预览折线立即可见，进入视口后再拉 ≤1500 点详情
    const previewView = buildMapView(item.previewPoints || [], item.type);
    const end = new Date(item.endTime || item.startTime + (item.duration || 0) * 1000);
    const out = {
      ...item,
      id: String(item._id || item.id || ''),
      iconImg: meta.iconImg || '',
      label: meta.label || item.type,
      previewPoints: item.previewPoints || [],
      distanceKm: (item.distance / 1000).toFixed(2).replace(/\.?0+$/, ''),
      durationText: formatHms(item.duration),
      caloriesText: formatThousands(item.calories || 0),
      dateText: `${start.getFullYear()}/${pad2(start.getMonth() + 1)}/${pad2(start.getDate())}`,
      timeRangeText: `${pad2(start.getHours())}:${pad2(start.getMinutes())}–${pad2(end.getHours())}:${pad2(end.getMinutes())}`,
      cityText: item.startCity || item.startProvince || '',
      startTimeText: new Date(item.startTime).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      timeText,
      mapReady: false,
      mapDetail: false,
      mapLoading: false,
      mapFailed: false,
      mapEmpty: false,
      mapPolyline: previewView ? previewView.polyline : [],
      mapIncludePoints: previewView ? previewView.includePoints : [],
      mapFitPoints: previewView ? previewView.fitPoints : [],
      mapCenter: previewView ? previewView.center : null,
    };
    // 个人最佳角标（列表卡片右侧）：命中多项时展示第一项 + 等N项；
    // 前纪录（已被刷新）优先级靠后，全为前纪录时角标灰显；无命中时不亮角标
    const hits = matchBest(out, best);
    const chosen = hits.find((h) => !h.former) || hits[0] || null;
    out.bestText = chosen ? (hits.length > 1 ? `${chosen.label} 等${hits.length}项` : chosen.label) : '';
    out.bestFormer = !!(chosen && chosen.former);
    return out;
  },

  /** 进入轨迹详情 */
  onTapItem(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({
      url: `/pages/track-detail/track-detail?id=${id}`,
    });
  },

  /** 左滑删除：二次确认后删除（后端会同步清理关联 OSS 照片） */
  async onDeleteTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const item = this.data.items.find((i) => i.id === id);
    const label = item ? `${item.label} · ${item.startTimeText}` : '该轨迹';
    const res = await new Promise((resolve) => {
      wx.showModal({
        title: '删除轨迹',
        content: `确定删除「${label}」吗？关联照片会同步删除，且不可恢复`,
        confirmText: '删除',
        confirmColor: '#e34d59',
        success: resolve,
        fail: () => resolve({ confirm: false }),
      });
    });
    if (!res.confirm) return;
    try {
      await api.del(`/activities/${id}`);
      if (this._mapCache) delete this._mapCache[id];
      const items = this.data.items.filter((i) => i.id !== id);
      this.setData({
        items,
        totalCount: Math.max(0, this.data.totalCount - 1),
        groups: this.buildGroups(items),
      });
      this.scheduleMapSync();
      this.syncMonthlyStats(); // 删除影响整月累计，重新拉取聚合
      markHomeDirty(); // 首页累计数据 / 榜名次 / 日历都会变
      wx.showToast({ title: '已删除', icon: 'success' });
    } catch (err) {
      console.error('删除轨迹失败', err);
      wx.showToast({ title: '删除失败，请重试', icon: 'none' });
    }
  },

  /** 分享给朋友 */
  onShareAppMessage() {
    return { title: '我的运动轨迹合集 · 小迹一下', path: '/pages/tracks/tracks' };
  },

  /** 分享到朋友圈 */
  onShareTimeline() {
    return { title: '我的运动轨迹合集 · 小迹一下' };
  },
});

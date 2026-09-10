const api = require('../../services/api');
const { formatDuration, formatPace, formatDurationStat } = require('../../utils/format');
const config = require('../../config/index');

const PAGE_SIZE = 20;
const VIEW_MODE_KEY = 'tracksViewMode';

/** 秒 → h:mm:ss（月度统计用） */
function formatHms(seconds) {
  const s = Math.round(seconds || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** 千分位整数（千卡展示用） */
function formatThousands(n) {
  return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
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
    viewMode: 'list', // 展示模式：list 单行列表（默认，按月分组）/ grid 图片（轨迹缩略图卡片）
    items: [],
    groups: [], // 列表模式按月分组：[{ key: '2026-9', label: '2026年9月', items }]
    monthlyStats: {}, // 后端按月聚合（整月全量）：key '2026-9' → { count, distance, duration, calories }
    page: 1,
    hasMore: true,
    loading: false,
    initialized: false,
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
  },

  onShow() {
    // 足迹地图"查看该省轨迹"入口：tab 页不能带参，经 globalData 传递
    const app = getApp();
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
    }
  },

  /** 清除省份筛选 */
  clearProvince() {
    this.setData({ provinceFilter: '', page: 1, items: [], hasMore: true });
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh());
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
      this.setData({ loading: true, page: 1, monthlyStats: {} }); // 重置聚合缓存，防上一次筛选的数据串味
      const data = await api.get('/activities', this.buildParams(1));
      const items = data.items.map(this.decorate);
      const monthly = mergeMonthly({}, data.monthlyStats); // 列表响应附带页内月份的全量聚合
      this.setData({
        items,
        groups: this.buildGroups(items, monthly),
        monthlyStats: monthly,
        hasMore: data.items.length >= PAGE_SIZE,
        initialized: true,
      });
    } catch (e) {
      console.error('加载轨迹列表失败', e);
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
      this.setData({ monthlyStats: map, groups: this.buildGroups(this.data.items, map) });
    } catch (e) {
      console.warn('月度统计拉取失败', e); // 静默：统计块沿用已加载条目的汇总
    }
  },

  async loadMore() {
    const next = this.data.page + 1;
    try {
      this.setData({ loading: true });
      const data = await api.get('/activities', this.buildParams(next));
      const items = this.data.items.concat(data.items.map(this.decorate));
      const monthly = mergeMonthly(this.data.monthlyStats, data.monthlyStats); // 新出现月份增量并入
      this.setData({
        items,
        groups: this.buildGroups(items, monthly),
        monthlyStats: monthly,
        page: next,
        hasMore: data.items.length >= PAGE_SIZE,
      });
    } catch (e) {
      console.error('加载更多失败', e);
    } finally {
      this.setData({ loading: false });
    }
  },

  /** 列表模式按月分组：items 时间倒序，依次归入「YYYY年M月」组（分页/删除后全量重建）；
   *  每组附带当月统计，优先用后端整月聚合（monthly 参数），未命中时回退到已加载条目的汇总 */
  buildGroups(items, monthly = this.data.monthlyStats || {}) {
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
    return params;
  },

  /** 列表项装饰：原始聚合数据 → 展示字段（后端返回 _id，补 id 映射） */
  decorate(item) {
    const meta = config.ACTIVITY_TYPES.find((t) => t.type === item.type) || {};
    const start = new Date(item.startTime);
    // 时间展示：一周内显示星期几，超过一周显示年月日
    const diffDays = Math.floor((Date.now() - start.getTime()) / 86400000);
    const timeText =
      diffDays < 7
        ? ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][start.getDay()]
        : `${start.getFullYear()}/${start.getMonth() + 1}/${start.getDate()}`;
    return {
      ...item,
      id: String(item._id || item.id || ''),
      icon: meta.icon || '🏃',
      iconImg: meta.iconImg || '',
      label: meta.label || item.type,
      color: '#4A5568', // 轨迹颜色统一深灰蓝（白底地图清晰；原 #808080 中灰偏淡看不清）
      previewPoints: item.previewPoints || [],
      distanceKm: (item.distance / 1000).toFixed(2).replace(/\.?0+$/, ''),
      durationText: (() => { const d = formatDurationStat(item.duration); return `${d.num}${d.unit}`; })(),
      startTimeText: new Date(item.startTime).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      paceText: item.avgPace ? formatPace(item.avgPace) : '—',
      timeText,
    };
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
      const items = this.data.items.filter((i) => i.id !== id);
      this.setData({ items, groups: this.buildGroups(items) });
      this.syncMonthlyStats(); // 删除影响整月累计，重新拉取聚合
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

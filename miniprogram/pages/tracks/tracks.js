const api = require('../../services/api');
const { formatDuration, formatPace, formatDurationStat } = require('../../utils/format');
const config = require('../../config/index');

const PAGE_SIZE = 20;
const VIEW_MODE_KEY = 'tracksViewMode';

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
      this.setData({ loading: true, page: 1 });
      const data = await api.get('/activities', this.buildParams(1));
      const items = data.items.map(this.decorate);
      this.setData({
        items,
        groups: this.buildGroups(items),
        hasMore: data.items.length >= PAGE_SIZE,
        initialized: true,
      });
    } catch (e) {
      console.error('加载轨迹列表失败', e);
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadMore() {
    const next = this.data.page + 1;
    try {
      this.setData({ loading: true });
      const data = await api.get('/activities', this.buildParams(next));
      const items = this.data.items.concat(data.items.map(this.decorate));
      this.setData({
        items,
        groups: this.buildGroups(items),
        page: next,
        hasMore: data.items.length >= PAGE_SIZE,
      });
    } catch (e) {
      console.error('加载更多失败', e);
    } finally {
      this.setData({ loading: false });
    }
  },

  /** 列表模式按月分组：items 时间倒序，依次归入「YYYY年M月」组（分页/删除后全量重建） */
  buildGroups(items) {
    const groups = [];
    const byKey = new Map();
    for (const item of items) {
      const d = new Date(item.startTime);
      const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
      let group = byKey.get(key);
      if (!group) {
        group = { key, label: `${d.getFullYear()}年${d.getMonth() + 1}月`, items: [] };
        byKey.set(key, group);
        groups.push(group);
      }
      group.items.push(item);
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

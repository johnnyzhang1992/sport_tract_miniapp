/**
 * 我的徽章（2026-11-16）
 *
 * 展示**全部**徽章（119 座）：计划类 15 座 + 运动数据类 104 座（含分运动类型 80 座）。
 * 数据：GET /plan/badges（与计划页的 /plan/summary 同源计算，两处结论一致）
 *
 * 页面结构：
 *   1. 顶部总览：已获得 / 总数 + 计划/数据分类计数
 *   2. 分类切换（全部 / 运动计划 / 运动数据）
 *   3. 徽章墙（与计划页同一组件）
 * 本页只展示徽章；分运动类型的距离/时长/次数统计在「统计」页，不在这里重复。
 */
const api = require('../../services/api');
// 徽章展示翻译（形状→样式类、类型图标、中央文字、是否三环）统一走 utils/badge-shape.js
const { shapeClassOf, centerTextOf, typeIconOf, isRingBadge } = require('../../utils/badge-shape.js');

/** 分类切换项：全部 / 计划 / 数据 */
const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'plan', label: '运动计划' },
  { key: 'data', label: '运动数据' },
];

Page({
  data: {
    loading: true,
    failed: false,
    filters: FILTERS,
    activeFilter: 'all',
    /** 服务端：{ total, earned, categories, groups, trophies }（activityTypes 只在统计页用，本页不展示） */
    data: null,
    /** 过滤后的展示用列表（组件吃这个） */
    shown: [],
    shownEarned: 0,
    shownTotal: 0,
  },

  onLoad() {
    this.fetch();
  },

  onPullDownRefresh() {
    this.fetch().finally(() => wx.stopPullDownRefresh());
  },

  async fetch() {
    this.setData({ loading: true, failed: false });
    try {
      const data = await api.get('/plan/badges');
      this.setData({ data, loading: false });
      this.applyFilter(this.data.activeFilter);
    } catch (e) {
      this.setData({ loading: false, failed: true });
    }
  },

  /** 分类切换：只过滤徽章列表，分组由组件按服务端 groups 处理 */
  onFilterTap(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.activeFilter) return;
    this.setData({ activeFilter: key });
    this.applyFilter(key);
  },

  applyFilter(key) {
    const all = (this.data.data && this.data.data.trophies) || [];
    const shown = key === 'all' ? all : all.filter((t) => t.category === key);
    this.setData({
      shown,
      shownEarned: shown.filter((t) => t.unlocked).length,
      shownTotal: shown.length,
    });
  },

  /** 徽章卡片点击：打开详情半屏 */
  onSelect(e) {
    const key = (e.detail || {}).key;
    const t = (this.data.data && this.data.data.trophies || []).find((x) => x.key === key);
    if (!t) return;
    const detailLines = [];
    if (t.detailText) detailLines.push(t.detailText);
    for (const line of t.detailLines || []) detailLines.push(line);
    this.setData({
      trophyDetail: {
        ...t,
        // 半屏渲染依赖 cls / badgeText / typeIcon / isRing 四个展示字段（统一由 utils 提供）
        cls: shapeClassOf(t.shape),
        badgeText: centerTextOf(t),
        typeIcon: typeIconOf(t),
        isRing: isRingBadge(t),
        detailLines,
      },
    });
  },

  closeTrophyDetail() {
    this.setData({ trophyDetail: null });
  },

  /** 半屏内容区拦截冒泡 */
  noop() {},
});

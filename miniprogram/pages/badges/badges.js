/**
 * 我的徽章（2026-11-16）
 *
 * 展示**全部**徽章（111 座）：计划类 15 座 + 运动数据类 96 座（含分运动类型 80 座）。
 * 2026-11-17：原「新纪录」整组（距离纪录/时长纪录 8 座）已下线，119 → 111。
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
    /** 游客态：不请求接口，展示登录引导（与首页/我的页同一套取舍） */
    notLoggedIn: false,
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

  /** 从其它页面回来（如去「我的」页登录后）：登录态变了就重新拉 */
  onShow() {
    const app = getApp();
    const logged = !!(app.globalData.loggedIn || app.hasSession());
    if (logged && this.data.notLoggedIn) this.fetch();
  },

  /** 游客态点击「去登录」：直接拉起登录，成功后原地刷新 */
  goLogin() {
    const app = getApp();
    app
      .login()
      .then(() => this.fetch())
      .catch((e) => wx.showToast({ title: (e && e.message) || '登录失败，请重试', icon: 'none' }));
  },

  async fetch() {
    this.setData({ loading: true, failed: false });
    // 游客态：/plan/badges 需要登录（401），不请求、不报错，直接展示登录引导。
    // 已注册用户（本地有 token）先静默恢复会话，与首页/我的页一致。
    const app = getApp();
    if (app.hasSession() && !app.globalData.loggedIn) {
      try {
        await app.login();
      } catch (e) {
        console.warn('静默登录失败', e);
      }
    }
    if (!app.hasSession() || !app.globalData.loggedIn) {
      this.setData({ loading: false, notLoggedIn: true, data: null });
      return;
    }
    this.setData({ notLoggedIn: false });
    try {
      const data = await api.get('/plan/badges');
      this.setData({ data, loading: false });
      this.applyFilter(this.data.activeFilter);
    } catch (e) {
      // 401 = 会话失效/未登录：按游客态处理，不显示「加载失败」吓人
      if (e && (e.statusCode === 401 || e.code === 401)) {
        this.setData({ loading: false, notLoggedIn: true, data: null });
        return;
      }
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

  /* ── 分享（2026-11-17）──────────────────────────────
     分享文案带上已获得数，让接收方一眼看出进度；朋友圈走单页模式（进入后仅展示内容）。
     不传 imageUrl 时微信会自动截取当前页面，徽章墙本身就是最好的封面。 */

  onShareAppMessage() {
    const d = this.data.data || {};
    const earned = d.earned || 0;
    const total = d.total || 0;
    return {
      title: total > 0 ? `我的运动徽章 · 已点亮 ${earned}/${total} 座` : '我的运动徽章',
      path: '/pages/badges/badges',
    };
  },

  /** 分享到朋友圈（单页模式） */
  onShareTimeline() {
    const d = this.data.data || {};
    const earned = d.earned || 0;
    const total = d.total || 0;
    return {
      title: total > 0 ? `我的运动徽章 · 已点亮 ${earned}/${total} 座` : '我的运动徽章',
      query: '',
    };
  },
});

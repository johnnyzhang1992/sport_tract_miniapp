/** 数字缩写：≥10000 → 1.22W，≥1000 → 1.22K，否则去尾零保留2位 */
function compact(v) {
  if (v >= 10000) return (v / 10000).toFixed(2).replace(/\.?0+$/, '') + 'W';
  if (v >= 1000) return (v / 1000).toFixed(2).replace(/\.?0+$/, '') + 'K';
  return String(Math.round(v * 100) / 100);
}

/** 时长格式化：≤999分钟→分钟；≤999小时→小时；否则→天 */
function formatDuration(seconds) {
  const min = seconds / 60;
  if (min <= 999) return { num: String(Math.round(min)), unit: '分钟' };
  const h = min / 60;
  if (h <= 999) return { num: String(Math.round(h * 10) / 10), unit: '小时' };
  return { num: String(Math.round((h / 24) * 10) / 10), unit: '天' };
}

const config = require('../../config/index');
const api = require('../../services/api');

// 首页概览本地缓存 key（先展示旧数据避免空白，接口返回后刷新）
const OVERVIEW_CACHE_KEY = 'indexOverviewCache_v1';

Page({
  data: {
    activityTypes: config.ACTIVITY_TYPES,
    selectedType: 'running',
    overview: null,
    overviewLabel: '今日概览',
    totalOverview: null, // 累计数据：轨迹数/总公里/点亮省份/城市
    heatData: [],
    notLoggedIn: false, // 游客态：展示登录引导
    loading: false,
    ongoingActivity: null, // 进行中（已暂停）运动入口
  },

  onShow() {
    this.applyDefaultType();
    this.loadOverview();
    this.checkOngoing();
  },

  /** 检查是否有“退出页面暂停”的运动，首页显示继续入口 */
  checkOngoing() {
    const ongoing = wx.getStorageSync('ongoingActivity');
    this.setData({ ongoingActivity: ongoing || null });
  },

  /** 未登录提示条 → 个人中心（tab 页用 switchTab） */
  goLogin() {
    wx.switchTab({ url: '/pages/my/my' });
  },

  /** 点击"继续运动"入口 → 回记录页（让用户选择继续/重新开始） */
  goOngoing() {
    const o = this.data.ongoingActivity;
    if (!o || !o.activityId) return;
    wx.navigateTo({
      url: `/pages/record/record?resume=1&activityId=${o.activityId}&type=${o.type || 'running'}`,
    });
  },

  /** 应用设置的默认运动类型（设置页保存到后端用户 settings） */
  async applyDefaultType() {
    try {
      const app = getApp();
      // 已注册用户（本地有 token）静默恢复登录；游客不自动登录
      if (app.hasSession() && !app.globalData.loggedIn) {
        await app.login();
      }
      if (!app.globalData.loggedIn) return;
      const user = await api.get('/users/me');
      const dt = user && user.settings && user.settings.defaultType;
      if (dt && config.ACTIVITY_TYPES.some((t) => t.type === dt)) {
        this.setData({ selectedType: dt });
      }
    } catch (e) {
      console.error('读取默认运动类型失败', e);
    }
  },

  onPullDownRefresh() {
    this.loadOverview().finally(() => wx.stopPullDownRefresh());
  },

  selectType(e) {
    this.setData({ selectedType: e.currentTarget.dataset.type });
  },

  /** 今日/本周/当月/今年概览（决策 F18）——请求去重 + 本地缓存先行 + 失败保留旧数据 */
  async loadOverview() {
    if (this._loadingOverview) return; // 进行中不重复请求（tab 快速切换竞态）
    this._loadingOverview = true;
    const app = getApp();
    // 已注册用户（本地有 token）静默恢复登录；游客不自动登录
    if (app.hasSession() && !app.globalData.loggedIn) {
      try {
        await app.login();
      } catch (e) {
        console.warn('静默登录失败', e);
      }
    }
    // 游客态：不读缓存/不请求，展示登录引导（登录后 onShow 重新加载）
    if (!app.globalData.loggedIn) {
      this._loadingOverview = false;
      this.setData({ loading: false, notLoggedIn: true, totalOverview: null, heatData: [] });
      return;
    }
    this.setData({ notLoggedIn: false });
    // 先用本地缓存渲染（冷启动/切 tab 不再空白），接口返回后再刷新
    const cached = wx.getStorageSync(OVERVIEW_CACHE_KEY);
    if (cached && cached.totalOverview) {
      this.setData({ totalOverview: cached.totalOverview, heatData: cached.heatData || [] });
    }
    try {
      const [overview, footprint, heat] = await Promise.all([
        api.get('/stats/overview'),
        api.get('/stats/footprint').catch(() => null),
        api.get('/stats/trend?days=365').catch(() => null),
      ]);
      const total = overview.total || { count: 0, distance: 0 };
      // 日历热力图数据（近 365 天按天距离）
      const heatData = heat && heat.data ? heat.data : [];
      // 预处理：公里/千卡 K·W 缩写
      const totalOverview = {
        trackCount: total.count || 0,
        totalKm: compact((total.distance || 0) / 1000),
        provinceCount: footprint ? footprint.provinceCount : 0,
        cityCount: footprint ? footprint.cityCount : 0,
      };
      this.setData({ totalOverview, heatData });
      // 成功后写缓存（下次先展示旧值）
      try {
        wx.setStorageSync(OVERVIEW_CACHE_KEY, { totalOverview, heatData, cachedAt: Date.now() });
      } catch (e) {
        // 缓存写失败不影响功能
      }
    } catch (e) {
      console.error('加载概览失败', e); // 保留旧数据（不置空，避免切换 tab 后空白）
    } finally {
      this._loadingOverview = false;
      this.setData({ loading: false });
    }
  },

  /** 开始运动 → 记录页（预检定位权限：无权限无法记录轨迹，先引导授权） */
  async startRecord() {
    const { ensureLocationAuth } = require('../../services/location-auth');
    const authed = await ensureLocationAuth();
    if (!authed) return; // 用户取消/未开启：留在首页
    wx.navigateTo({
      url: `/pages/record/record?type=${this.data.selectedType}`,
    });
  },

  /** 分享给朋友 */
  onShareAppMessage() {
    return { title: '记录每一次运动，我的运动小程序', path: '/pages/index/index' };
  },

  /** 分享到朋友圈 */
  onShareTimeline() {
    return { title: '记录每一次运动，我的运动小程序' };
  },
});

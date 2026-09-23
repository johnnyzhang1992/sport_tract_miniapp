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
    // 各接口失败原因（null=正常）：卡片不能悄悄消失，文案点名到接口与实际报错
    overviewError: null,
    footprintError: null,
    heatError: null,
    notLoggedIn: false, // 游客态：展示登录引导
    loading: false,
    ongoingActivity: null, // 进行中（已暂停）运动入口
    lbSummary: null, // 运动榜摘要（卡片副标题）
    topics: [], // 生效中的官方专题（首页入口）
  },

  onLoad() {
    this.setupUpdateCheck();
  },

  onShow() {
    this.applyDefaultType();
    this.loadOverview();
    this.loadLeaderboardSummary();
    this.loadActiveTopics();
    this.checkOngoing();
  },

  /** 官方专题（生效中）：静默拉取，失败不打扰；游客也可看 */
  async loadActiveTopics() {
    try {
      const topics = await api.get('/topics/active');
      this.setData({ topics: topics || [] });
    } catch (e) {
      // 静默：专题入口不展示
    }
  },

  /** 专题入口 → 专题详情 */
  goTopic(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/topic/topic?id=${id}` });
  },

  /** 版本更新检测：微信后台下载完新版本包后弹窗提醒，确认即应用并重启 */
  setupUpdateCheck() {
    // 低版本基础库无此 API（开发版不会有更新回调），静默跳过
    if (!wx.getUpdateManager) return;
    const manager = wx.getUpdateManager();
    manager.onUpdateReady(() => {
      wx.showModal({
        title: '发现新版本',
        content: '新版本已经准备好，是否重启应用？',
        confirmText: '立即重启',
        cancelText: '稍后',
        success: (res) => {
          if (res.confirm) manager.applyUpdate();
        },
      });
    });
    manager.onUpdateFailed(() => {
      wx.showModal({
        title: '更新失败',
        content: '新版本下载失败，请删除当前小程序后重新搜索打开',
        showCancel: false,
      });
    });
  },

  /** 检查是否有“退出页面暂停”的运动，首页显示继续入口（超过 24h 不再展示并清理本地标记） */
  checkOngoing() {
    const ongoing = wx.getStorageSync('ongoingActivity');
    let show = ongoing || null;
    if (ongoing && ongoing.startTime && Date.now() - ongoing.startTime > 24 * 3600 * 1000) {
      wx.removeStorageSync('ongoingActivity');
      show = null;
    }
    this.setData({ ongoingActivity: show });
  },

  /** 未登录提示条 → 个人中心（tab 页用 switchTab） */
  goLogin() {
    wx.switchTab({ url: '/pages/my/my' });
  },

  /** 运动榜入口卡片 → 榜单页 */
  goLeaderboard() {
    wx.navigateTo({ url: '/pages/leaderboard/leaderboard' });
  },

  /** 运动榜摘要（卡片副标题）：全国点亮人数 + 我的排名（失败静默） */
  async loadLeaderboardSummary() {
    if (this.data.notLoggedIn) return;
    try {
      const api = getApp().globalData.api;
      const regions = await api.get('/stats/leaderboard-regions');
      const meText = await this.findMyRankText(api);
      this.setData({ lbSummary: { totalUsers: regions.totalUsers, meText } });
    } catch (e) {
      // 静默：卡片仍展示默认文案
    }
  },

  /** 依次查 周榜→月榜→年榜→总榜，取最先有上榜类型的周期生成文案（都不在榜返回空） */
  async findMyRankText(api) {
    const periods = [
      { key: 'week', label: '周榜' },
      { key: 'month', label: '月榜' },
      { key: 'year', label: '年榜' },
      { key: 'all', label: '总榜' },
    ];
    for (const { key, label } of periods) {
      try {
        const res = await api.get(`/stats/leaderboard/me?period=${key}`);
        if (res.best) {
          // 多类型同时上榜时后端已取名次最优（best），类型文案从本地配置映射
          const t = config.ACTIVITY_TYPES.find((x) => x.type === res.best.type);
          return `，我的${(t && t.label) || '运动'}全国${label}第${res.best.rank}名`;
        }
      } catch (e) {
        return ''; // 查询失败则放弃，静默
      }
    }
    return '';
  },

  /** 点击"继续运动"入口 → 回记录页（让用户选择继续/重新开始） */
  goOngoing() {
    const o = this.data.ongoingActivity;
    if (!o || !o.activityId) return;
    wx.navigateTo({
      url: `/pages/record/record?resume=1&activityId=${o.activityId}&type=${o.type || 'running'}`,
    });
  },

  /** 点击累计数据卡片 → 数据统计页 */
  goStats() {
    wx.navigateTo({ url: '/pages/stats/stats' });
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
    // 有未保存运动时让位（避免两个原生 Modal 同帧互顶），本次会话进个人中心登录时仍会补弹
    if (app.globalData.loggedIn && !wx.getStorageSync('pending_summary')) app.maybeShowProfileGuide();
    // 游客态：不读缓存/不请求，展示登录引导（登录后 onShow 重新加载）
    if (!app.globalData.loggedIn) {
      this._loadingOverview = false;
      this.setData({
        loading: false,
        notLoggedIn: true,
        totalOverview: null,
        heatData: [],
        overviewError: null,
        footprintError: null,
        heatError: null,
      });
      return;
    }
    this.setData({ notLoggedIn: false });
    // 先用本地缓存渲染（冷启动/切 tab 不再空白），接口返回后再刷新
    const cached = wx.getStorageSync(OVERVIEW_CACHE_KEY);
    if (cached && cached.totalOverview) {
      this.setData({ totalOverview: cached.totalOverview, heatData: cached.heatData || [] });
    }
    try {
      // 每个接口自己兜住失败：原先三个请求共用一个 Promise.all，/stats/overview 一挂就把不相关的
      // 日历一起拖没，现场只剩一句 console.error —— 用户看到的只是「日历不见了」
      const failed = {};
      const soft = (key, label) => (p) =>
        p.catch((e) => {
          failed[key] = `${label}：${(e && e.message) || String(e)}`;
          return null;
        });
      const [overview, footprint, heat] = await Promise.all([
        soft('overview', '累计数据')(api.get('/stats/overview')),
        soft('footprint', '点亮省市')(api.get('/stats/footprint')),
        soft('heat', '运动日历')(api.get('/stats/trend?days=365')),
      ]);
      const patch = {
        overviewError: failed.overview || null,
        footprintError: failed.footprint || null,
        heatError: failed.heat || null,
      };
      if (!failed.overview) {
        const total = overview.total || { count: 0, distance: 0 };
        const prev = this.data.totalOverview || {};
        patch.totalOverview = {
          trackCount: total.count || 0,
          totalKm: compact((total.distance || 0) / 1000), // 公里/千卡 K·W 缩写
          // 省市来自另一个接口：它失败就留着屏上旧值，别把「3 省」刷成 0
          provinceCount: failed.footprint ? prev.provinceCount || 0 : footprint.provinceCount,
          cityCount: failed.footprint ? prev.cityCount || 0 : footprint.cityCount,
        };
      }
      // 日历失败同理不清空：屏上留着近 365 天的旧点，比刷成空白更等得起重试
      if (!failed.heat) patch.heatData = (heat && heat.data) || [];
      this.setData(patch);
      // 全绿才写缓存（下次先展示旧值）；半套数据不落盘——否则下次冷启动会把「某个接口挂了」
      // 掩盖成「你的数据就是这些」
      if (!patch.overviewError && !patch.footprintError && !patch.heatError) {
        try {
          wx.setStorageSync(OVERVIEW_CACHE_KEY, {
            totalOverview: patch.totalOverview,
            heatData: patch.heatData,
            cachedAt: Date.now(),
          });
        } catch (e) {
          // 缓存写失败不影响功能
        }
      }
    } catch (e) {
      console.error('[index] 概览落地异常', e); // 走到这里说明是上面这段自己炸了
    } finally {
      this._loadingOverview = false;
      this.setData({ loading: false });
    }
  },

  /** 卡内「重试」：失败提示已点名是哪个接口，网络恢复后点一下即可。
   *  不做自动重试——断网时反复打后端只会把一次失败变成几次超时等待 */
  retryOverview() {
    return this.loadOverview();
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
    return { title: '记录每一次运动 · 小迹一下', path: '/pages/index/index' };
  },

  /** 分享到朋友圈 */
  onShareTimeline() {
    return { title: '记录每一次运动 · 小迹一下' };
  },
});

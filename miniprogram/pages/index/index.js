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
const { avatarStack } = require('../../utils/campaign.js');

// 首页概览本地缓存 key（先展示旧数据避免空白，接口返回后刷新）
const OVERVIEW_CACHE_KEY = 'indexOverviewCache_v1';

/** onShow 自动刷新的节流窗口：切 tab 回来不必每次全量重拉；下拉刷新 / 登录态变化 / homeDirty 可越过它 */
const HOME_TTL_MS = 60 * 1000;

/** 概览三段在合并响应里的字段 → 卡片上的名字（失败文案要落到自己那张卡上） */
const SECTION_LABELS = { overview: '累计数据', footprint: '点亮省市', heat: '运动日历' };

/** 榜名次 label 用的周期名（服务端回 period，端上不再自己探周期） */
const PERIOD_LABEL = { week: '周榜', month: '月榜', year: '年榜', all: '总榜' };

/** 首页活动卡：标题 + 成员面（人数 + 头像堆叠）——WXML 不做格式化，统一在这里算好 */
function toCampaignCard(c) {
  return Object.assign({}, c, {
    memberText: `${c.memberCount || 0} 人`,
    avatarList: avatarStack(c.memberAvatars), // 签名 url 优先，回退预设图（见 utils/campaign.js）
  });
}

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
    campaigns: [], // 进行中的一起运动活动（首页区块，最多 3 条）
    notice: null, // 首页单行通知（{id,title}；null=不渲染）
    noticeDot: false, // 红点：登录用户才画
    favGuide: { visible: false, top: 0, right: 12, arrowRight: 20 }, // 收藏引导浮层
  },

  onLoad() {
    this.setupUpdateCheck();
    // 收藏引导：等首屏渲染稳定后再弹，不打架
    setTimeout(() => this.maybeShowFavGuide(), 800);
  },

  /**
   * 收藏引导浮层：指向右上角胶囊，引导「收藏 / 添加到我的小程序」。
   * 微信没有查询收藏状态的 API（收藏与否读不到），所以只能按展示次数控制：
   * 每台设备最多弹 3 次（一次冷启动至多一次），点「知道了」后永不再弹。
   */
  maybeShowFavGuide() {
    try {
      if (wx.getStorageSync('favGuideDismissed')) return;
      const shown = Number(wx.getStorageSync('favGuideShowCount') || 0);
      if (shown >= 3) return;
      const rect = wx.getMenuButtonBoundingClientRect();
      if (!rect || !rect.width) return;
      const { windowWidth } = wx.getSystemInfoSync();
      this.setData({
        favGuide: {
          visible: true,
          // 纵向固定贴视口顶部：原生导航栏下方就是胶囊，fixed 的原点在导航栏之下，
          // 不要用 rect.bottom（那是含状态栏/导航栏的屏幕系坐标，会整体偏下 ~70px）
          top: 8,
          right: Math.max(8, windowWidth - rect.right), // 横向原点一致，rect 可直接用
          arrowRight: Math.max(10, windowWidth - (rect.left + rect.width / 2)), // 箭头对准胶囊中线（right 越大越靠左，需再左移就在此处加值）
        },
      });
      wx.setStorageSync('favGuideShowCount', shown + 1);
    } catch (e) {
      // 任一环境异常都不影响首页
    }
  },

  /** 关闭引导；点「知道了」视为已知悉，永不再弹 */
  closeFavGuide() {
    this.setData({ 'favGuide.visible': false });
    try {
      wx.setStorageSync('favGuideDismissed', true);
    } catch (e) {}
  },

  onShow() {
    this.applyDefaultType();
    // 节流：60s 内切 tab 回来不再全量重拉；但登录态变化（游客登录 / 退出）与 homeDirty
    // （刚跑完、刚加入/退出活动、刚删除轨迹）必须越过 TTL，否则用户会看到旧数字。
    const app = getApp();
    const session = app.hasSession();
    const due = Date.now() - (this._lastAutoLoadAt || 0) >= HOME_TTL_MS;
    const sessionChanged = session !== this._autoLoadSession;
    // 读完通知回来：只补通知摘要，不触发整屏重拉
    const noticeDirty = app.globalData.notificationDirty;
    app.globalData.notificationDirty = false;
    if (due || sessionChanged || app.globalData.homeDirty) {
      this._lastAutoLoadAt = Date.now();
      this._autoLoadSession = session;
      app.globalData.homeDirty = false;
      this.loadOverview();
      this.loadLeaderboardSummary();
      this.loadActiveTopics();
      this.loadCampaigns();
      this.loadNotificationSummary(); // 整屏批次里一并拉（noticeDirty 也随之消费）
    } else if (noticeDirty) {
      this.loadNotificationSummary();
    }
    this.checkOngoing();
  },

  /** 首页单行通知摘要：登录用户取最新未读，游客取最新已发布；失败静默不显示 */
  async loadNotificationSummary() {
    try {
      const res = await api.get('/notifications/summary');
      this.setData({
        notice: (res && res.item) || null,
        noticeDot: !!getApp().hasSession(),
      });
    } catch (e) {
      this.setData({ notice: null, noticeDot: false });
    }
  },

  /** 通知条 → 详情 */
  goNotice(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/notification/notification?id=${id}` });
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

  /**
   * 一起运动（进行中）：只拉「我参与」一路 —— 服务端的 joined 筛选取 role ∈ ['member','creator']
   * 且 joinedAt 非空的成员行，本来就把我发起的活动包含在内；原先并发 created 一路再按 id 去重，
   * 等于同一个集合打两遍。
   * status 直接用服务端派生的档位筛 active，不按 endAt 本地再算一遍（两边口径不分叉）。
   * 游客直接退：接口要求登录，发出去必然 401。闸门判 hasSession() 而不是
   * globalData.loggedIn——onShow 不 await 静默恢复，老用户冷启动那一刻 loggedIn 还是 false，
   * 而 api.get 是从 storage 取 token 的；拿 loggedIn 判会把他们误当游客、区块整个空掉。
   * 网络失败仍静默：区块退化成「发起一个活动」引导，不打扰首屏。
   */
  async loadCampaigns() {
    if (!getApp().hasSession()) {
      this.setData({ campaigns: [] });
      return;
    }
    try {
      const data = await api.get('/campaigns?role=joined');
      const items = (data && data.items) || [];
      this.setData({
        campaigns: items.filter((c) => c && c.status === 'active').slice(0, 3).map(toCampaignCard),
      });
    } catch (e) {
      // 静默：区块显示发起引导即可
      this.setData({ campaigns: [] });
    }
  },

  /** 活动卡片 → 活动详情 */
  goCampaign(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/campaign-detail/campaign-detail?id=${id}` });
  },

  /** 「查看全部」→ 活动列表页 */
  goCampaignList() {
    wx.navigateTo({ url: '/pages/campaign-list/campaign-list' });
  },

  /** 无进行中活动时的引导卡 → 创建活动页 */
  goCampaignCreate() {
    wx.navigateTo({ url: '/pages/campaign-create/campaign-create' });
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

  /**
   * 运动榜摘要（卡片副标题）：全国点亮人数 + 我的排名（失败静默）。
   * ?me=1 让服务端一次带回两样：周期回退（周→月→年→总）原先在端上串行打最多 4 次接口，
   * 现在收进一个请求；`me.period` 就是选中的周期，label 直接按它拼。
   * 老服务端不下发 me → ranks 退化为空，人数照常展示。
   */
  async loadLeaderboardSummary() {
    if (!getApp().hasSession() || this.data.notLoggedIn) return;
    try {
      const res = await api.get('/stats/leaderboard-regions?me=1');
      const me = res.me || {};
      const period = me.period || '';
      const ranks = Array.isArray(me.ranks) ? me.ranks : [];
      this.setData({
        lbSummary: {
          totalUsers: res.totalUsers,
          ranks: ranks.slice(0, 2).map((r) => { // 卡片最多 1+2=3 行
            const t = config.ACTIVITY_TYPES.find((x) => x.type === r.type);
            return { type: r.type, rank: r.rank, label: `${(t && t.label) || '运动'}${PERIOD_LABEL[period] || '榜'}` };
          }),
        },
      });
    } catch (e) {
      // 静默：卡片仍展示默认文案
    }
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

  /**
   * 应用设置的默认运动类型（设置页保存到后端用户 settings）。
   * 不再为此单独打 /users/me：登录响应本来就下发 user.settings，设置页保存后也会写回 globalData；
   * 首页每次 onShow 多打一个接口只为读一个字段不值得。
   */
  async applyDefaultType() {
    try {
      const app = getApp();
      // 已注册用户（本地有 token）静默恢复登录；游客不自动登录
      if (app.hasSession() && !app.globalData.loggedIn) {
        await app.login();
      }
      if (!app.globalData.loggedIn) return;
      const user = app.globalData.userInfo || {};
      const dt = user.settings && user.settings.defaultType;
      if (dt && config.ACTIVITY_TYPES.some((t) => t.type === dt)) {
        this.setData({ selectedType: dt });
      }
    } catch (e) {
      console.error('读取默认运动类型失败', e);
    }
  },

  onPullDownRefresh() {
    // 下拉是「刷新这一屏」：越过 onShow 的 TTL，把五块都重拉一次
    this._lastAutoLoadAt = 0;
    Promise.all([
      this.loadOverview(),
      this.loadLeaderboardSummary(),
      this.loadActiveTopics(),
      this.loadCampaigns(),
      this.loadNotificationSummary(),
    ]).finally(() => wx.stopPullDownRefresh());
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
      // 三段合成一个请求（/stats/home），服务端按段包成 {ok,data|error}。
      // 合并**不能**把 3cb2d5e 修掉的「一个接口挂掉、整块卡片消失」请回来：
      // 每段失败只落到自己那张卡上，旧值不清空；整请求失败则三段一起如实标出来。
      let sections;
      try {
        sections = (await api.get('/stats/home')) || {};
      } catch (e) {
        const msg = (e && e.message) || String(e);
        sections = {
          overview: { ok: false, error: msg },
          footprint: { ok: false, error: msg },
          heat: { ok: false, error: msg },
        };
      }
      const failed = {};
      for (const key of Object.keys(SECTION_LABELS)) {
        const sec = sections[key];
        if (!sec || sec.ok !== true) {
          failed[key] = `${SECTION_LABELS[key]}：${(sec && sec.error) || '响应缺失'}`;
        }
      }
      const patch = {
        overviewError: failed.overview || null,
        footprintError: failed.footprint || null,
        heatError: failed.heat || null,
      };
      if (!failed.overview) {
        const total = sections.overview.data.total || { count: 0, distance: 0 };
        const prev = this.data.totalOverview || {};
        patch.totalOverview = {
          trackCount: total.count || 0,
          totalKm: compact((total.distance || 0) / 1000), // 公里/千卡 K·W 缩写
          // 省市来自另一段：它失败就留着屏上旧值，别把「3 省」刷成 0
          provinceCount: failed.footprint ? prev.provinceCount || 0 : sections.footprint.data.provinceCount,
          cityCount: failed.footprint ? prev.cityCount || 0 : sections.footprint.data.cityCount,
        };
      }
      // 日历失败同理不清空：屏上留着近 365 天的旧点，比刷成空白更等得起重试
      if (!failed.heat) patch.heatData = (sections.heat.data && sections.heat.data.data) || [];
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

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
// 首页运动类型显示开关（设置页可开关非默认类型，纯前端控制）
const sportDisplay = require('../../utils/sport-display');

// 首页概览本地缓存 key（先展示旧数据避免空白，接口返回后刷新）
const OVERVIEW_CACHE_KEY = 'indexOverviewCache_v1';

/** onShow 自动刷新的节流窗口：切 tab 回来不必每次全量重拉；下拉刷新 / 登录态变化 / homeDirty 可越过它 */
const HOME_TTL_MS = 60 * 1000;

/** 榜名次 label 用的周期名（服务端回 period，端上不再自己探周期） */
const PERIOD_LABEL = { week: '周榜', month: '月榜', year: '年榜', all: '总榜' };

/** 近 365 天全 0 的空日历数据（游客态占位：卡片正常渲染、格子全为"无运动"色） */
function emptyHeatData() {
  const out = [];
  const today = new Date();
  for (let i = 364; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push({ date: key, distance: 0, count: 0 });
  }
  return out;
}


Page({
  data: {
    activityTypes: config.ACTIVITY_TYPES,
    selectedType: 'running',
    overview: null,
    overviewLabel: '今日概览',
    heatData: [],
    // 日历段失败原因（null=正常）：卡片不能悄悄消失，文案点名到接口与实际报错
    heatError: null,
    notLoggedIn: false, // 游客态：展示登录引导
    loading: false,
    ongoingActivity: null, // 进行中（已暂停）运动入口
    lbSummary: null, // 运动榜摘要（卡片副标题）
    stepsSummary: null, // 微信步数榜摘要（右侧卡片：今日排名/步数；游客回落参与人数）
    planCard: null, // 运动计划卡（三环 + 右侧目标信息）；null＝无计划 → 引导卡
    topics: [], // 生效中的官方专题（首页入口）
    notice: null, // 首页单行通知（{id,title}；null=不渲染）
    noticeDot: false, // 红点：登录用户才画
    favGuide: { visible: false, top: 0, right: 12, arrowRight: 20 }, // 收藏引导浮层
  },

  onLoad() {
    this.applySportDisplay();
    // 设置页开关是即时生效的存储写；本页活着时收到变化就原地刷网格
    this._offSportDisplay = sportDisplay.onChange(() => this.applySportDisplay());
    this.setupUpdateCheck();
    // 收藏引导：等首屏渲染稳定后再弹，不打架
    setTimeout(() => this.maybeShowFavGuide(), 800);
  },

  onUnload() {
    if (this._offSportDisplay) this._offSportDisplay();
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

  /** 运动类型网格 = config 全集按设置页开关过滤后的子集（常显四类 + 用户打开的类型） */
  applySportDisplay() {
    this.setData({ activityTypes: sportDisplay.visibleTypes() });
  },

  onShow() {
    // 设置页可能改过运动类型开关：进页先重算网格，再把已不可见的选中类型回落到跑步
    this.applySportDisplay();
    if (!sportDisplay.isTypeVisible(this.data.selectedType)) {
      this.setData({ selectedType: 'running' });
    }
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
      // 首屏只等这两块：通知条在顶部、日历/累计数据在第一屏；新榜/步数榜/专题在首屏之外，
      // 等这一帧渲染完再拉，避免它们和首屏抢带宽（nextTick 后即「已绘制」）
      this.loadOverview();
      this.loadNotificationSummary(); // 整屏批次里一并拉（noticeDirty 也随之消费）
      wx.nextTick(() => {
        this.loadLeaderboardSummary();
        this.loadStepsSummary();
        this.loadPlan();
        this.loadActiveTopics();
      });
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
          ranks: ranks.slice(0, 1).map((r) => { // 只展示一条上榜数据（服务端已截首条，这里兜底）
            const t = config.ACTIVITY_TYPES.find((x) => x.type === r.type);
            return { type: r.type, rank: r.rank, label: `${(t && t.label) || '运动'}${PERIOD_LABEL[period] || '榜'}` };
          }),
        },
      });
    } catch (e) {
      // 静默：卡片仍展示默认文案
    }
  },

  /** 首页步数榜摘要：今日我的排名与步数；游客/无数据回落参与人数；失败静默 */
  async loadStepsSummary() {
    try {
      const res = await api.get('/werun/board?period=day');
      if (!res) return;
      const me = res.me || null;
      this.setData({
        stepsSummary: me
          ? { rank: me.rank, step: me.step || 0, players: res.players || 0 }
          : { players: res.players || 0 },
      });
    } catch (e) {
      // 静默：卡片仍展示默认文案
    }
  },

  /** 步数榜卡片 → 微信步数排行榜页 */
  goWerunBoard() {
    wx.navigateTo({ url: '/pages/werun-board/werun-board' });
  },

  /** 运动计划卡：拉计划与当期进度；有计划 → 准备三环数据并绘制；无计划 → 引导卡 */
  async loadPlan() {
    try {
      const d = await api.get('/plan/current');
      if (!d || !d.plan) {
        this.setData({ planCard: null });
        return;
      }
      const t = d.plan.targets;
      const km = (m) => (Math.round(m / 100) / 10).toFixed(1);
      this.setData({
        planCard: {
          plan: true,
          periodText: d.plan.period === 'weekly' ? '每周' : '每日',
          // 数字与目标分开：数字单独放大着色，目标走次要小字
          distanceValue: km(d.progress.distanceM), distanceNum: km(t.distanceM),
          durationValue: String(Math.round(d.progress.durationSec / 60)), durationNum: String(t.durationMin),
          countValue: String(d.progress.count), countNum: String(t.count),
          // 今日运动距离来自 /plan/current 的 today 段；今日步数复用步数榜摘要（未同步时显示 0）
          todayDistance: km((d.today && d.today.distanceM) || 0),
          todayDuration: String(Math.round(((d.today && d.today.durationSec) || 0) / 60)),
          pcts: (d.rings || []).map((r) => r.pct),
        },
      });
      wx.nextTick(() => this.drawPlanRings());
    } catch (e) {
      // 静默：卡片维持上一帧状态
    }
  },

  /** 三同心环绘制（canvas 2d）：底环灰（数据为空也常驻渲染）、进度弧顶部起顺时针、超额封顶。
   *  尺寸不依赖 fields().size（实测对 wx:if 内的 canvas 会返回 undefined），改由 140rpx 换算 px。 */
  drawPlanRings(retry = 1) {
    this.createSelectorQuery().select('#plan-rings').node((res) => {
      const canvas = res && res.node;
      if (!canvas) {
        if (retry > 0) setTimeout(() => this.drawPlanRings(retry - 1), 120);
        return;
      }
      try {
        const info = wx.getSystemInfoSync();
        const cssSize = Math.max(50, (info.screenWidth * 110) / 750); // .plan-rings 宽 110rpx 换算 px
        const dpr = info.pixelRatio || 2;
        canvas.width = cssSize * dpr;
        canvas.height = cssSize * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        const cx = cssSize / 2;
        const cy = cssSize / 2;
        // 外→内：距离（红）/ 时间（绿）/ 次数（青）；底环＝同色低透明度
        const rings = [
          { r: cx - 5, rgb: '250,17,79', pct: (this.data.planCard && this.data.planCard.pcts[0]) || 0 },
          { r: cx - 16, rgb: '146,232,42', pct: (this.data.planCard && this.data.planCard.pcts[1]) || 0 },
          { r: cx - 27, rgb: '26,212,224', pct: (this.data.planCard && this.data.planCard.pcts[2]) || 0 },
        ];
        const LW = 6;
        ctx.clearRect(0, 0, cssSize, cssSize);
        ctx.lineWidth = LW;
        ctx.lineCap = 'round';
        for (const ring of rings) {
          ctx.beginPath();
          ctx.strokeStyle = `rgba(${ring.rgb}, 0.25)`; // 底环：同色 25% 透明度
          ctx.arc(cx, cy, ring.r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.strokeStyle = `rgb(${ring.rgb})`; // 进度弧：实色（超额封顶满环）
          ctx.arc(cx, cy, ring.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, ring.pct));
          ctx.stroke();
        }
      } catch (err) {
        console.error('[index] 运动计划环绘制失败', err);
      }
    }).exec();
  },

  /** 运动计划卡 → 计划历史（月历）；改计划入口在历史页右上角 */
  goPlan() {
    wx.navigateTo({ url: '/pages/plan-history/plan-history' });
  },

  /** 点击"继续运动"入口 → 回记录页（让用户选择继续/重新开始） */
  goOngoing() {
    const o = this.data.ongoingActivity;
    if (!o || !o.activityId) return;
    wx.navigateTo({
      url: `/pages/record/record?resume=1&activityId=${o.activityId}&type=${o.type || 'running'}`,
    });
  },

  onPullDownRefresh() {
    // 下拉是「刷新这一屏」：越过 onShow 的 TTL，把五块都重拉一次
    this._lastAutoLoadAt = 0;
    Promise.all([
      this.loadOverview(),
      this.loadLeaderboardSummary(),
      this.loadStepsSummary(),
      this.loadPlan(),
      this.loadActiveTopics(),
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
    // 游客态：不读缓存/不请求，展示登录引导（登录后 onShow 重新加载）。
    // 运动日历仍渲染：给一份近 365 天全 0 的空日历（页面骨架完整，登录引导更有着落）
    if (!app.globalData.loggedIn) {
      this._loadingOverview = false;
      this.setData({
        loading: false,
        notLoggedIn: true,
        heatData: emptyHeatData(),
        heatError: null,
      });
      return;
    }
    this.setData({ notLoggedIn: false });
    // 先用本地缓存渲染（冷启动/切 tab 不再空白），接口返回后再刷新
    const cached = wx.getStorageSync(OVERVIEW_CACHE_KEY);
    if (cached && cached.heatData) {
      this.setData({ heatData: cached.heatData || [] });
    }
    try {
      // /stats/home 仍按段返回 {ok,data|error}；首页 2026-11-04 起只消费日历段
      // （累计数据已移到「统计」tab），其余两段失败不再影响本页。
      let sections;
      try {
        sections = (await api.get('/stats/home')) || {};
      } catch (e) {
        sections = { heat: { ok: false, error: (e && e.message) || String(e) } };
      }
      const heatSec = sections.heat;
      // 日历失败不清空：屏上留着近 365 天的旧点，比刷成空白更等得起重试
      const patch = heatSec && heatSec.ok === true
        ? { heatError: null, heatData: (heatSec.data && heatSec.data.data) || [] }
        : { heatError: `运动日历：${(heatSec && heatSec.error) || '响应缺失'}` };
      this.setData(patch);
      // 只有日历成功才写缓存（下次先展示旧值）；失败落盘会把「接口挂了」掩盖成「你没有数据」
      if (!patch.heatError) {
        try {
          wx.setStorageSync(OVERVIEW_CACHE_KEY, { heatData: patch.heatData, cachedAt: Date.now() });
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
  retryHeat() {
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

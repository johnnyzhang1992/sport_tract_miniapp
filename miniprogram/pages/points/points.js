const api = require('../../services/api');
const { ensureLogin, waitSession } = require('../../utils/login-gate');
const { buildSigninStrip, buildTaskRows, buildItemCards, md } = require('../../utils/points-view');
const { setAdFreeUntil } = require('../../utils/ad-free');
const { createRewardedAd, isAdRewardEligible } = require('../../utils/rewarded-ad');
const { currentMonth } = require('../../utils/footprint-calendar');
// cells 的 dateKey 是东八区 YYYY-MM-DD，「今天」比对键必须同口径：用 bjDate，不再写一份时区偏移
const { bjDate } = require('../../utils/bj-date');

Page({
  data: {
    loggedIn: false,
    loading: true,
    failed: false,
    balance: 0,
    signin: {},
    strip: [],
    chips: [],
    // 百分位副题：连签 0 天时不显示「超过 0% 用户」，换成引导语（口径见服务端 streakPercentile）
    streakSub: '',
    streakPercent: 0,
    // 过期提醒：服务端只在最早批次 ≤30 天时下发，null 就整行不渲染
    expiring: null,
    taskGroups: { onceTasks: [], dailyTasks: [] },
    items: [],
    cards: 0,
    videoBusy: false,
    // 签到月历半屏：月份与逐日状态都由本页取数，组件只渲染（同足迹弹窗口径）
    calVisible: false,
    calMonth: '',
    calDays: [],
    calLoading: false,
    calFailed: false,
  },

  onLoad() {
    this.ad = null;
    this.fetch();
  },

  onShow() {
    // onLoad 后紧跟的首次 onShow 不重复请求；之后每次回到本页都重拉，
    // 顺带覆盖「上次停在游客引导、现在已在别处登录」这种状态
    if (!this.entered) {
      this.entered = true;
      return;
    }
    this.fetch();
  },

  onUnload() {
    this.ad = null;
  },

  async fetch(silent = false) {
    // silent：下拉刷新等「已有内容再拉取」的场景，不闪 loading 骨架，失败用 toast 提示
    this.setData({ loading: !silent, failed: false });
    // 登录闸门走触点级：进页不自动弹登录，游客先看引导；但冷启动直达时先等 onLaunch 那次静默登录
    if (!(await waitSession())) {
      this.setData({ loading: false, loggedIn: false });
      return;
    }
    try {
      const data = await api.get('/points/summary');
      // 免广告权益的第二个来源：兑换/激活/到期后回到本页就刷新端上缓存（广告组件读它）
      setAdFreeUntil(data.adFreeUntil);
      const signin = data.signin || {};
      const streakDay = Number(signin.streakDay) || 0;
      // 只格式化、不推导：位置/分值/可补性一律来自服务端 cells（spec §5.1），state==='makeup' 是唯一入口判据
      const cells = signin.cells || [];
      this.setData({
        loggedIn: true,
        loading: false,
        balance: data.balance ?? 0,
        signin,
        expiring: data.expiring || null,
        strip: buildSigninStrip(cells, bjDate(Date.now())),
        hasMakeup: cells.some((c) => c.state === 'makeup'),
        streakSub: streakDay > 0 ? `超过 ${Number(data.streakPercentile) || 0}% 用户` : '今天签到开启连签',
        streakPercent: Number(data.streakPercentile) || 0,
        taskGroups: buildTaskRows(data.tasks || []),
        items: buildItemCards(data.items),
        cards: signin.cards || 0,
      });
      // 弹窗开着时补签/签到会改变整月状态，跟着重拉当月；关着就不多打一次请求
      if (this.data.calVisible) this.loadCalendar(this.data.calMonth);
    } catch (e) {
      if (silent) {
        // 静默刷新失败：保留已有内容，toast 提示即可（顶掉整页失败块反而晃眼）
        this.setData({ loading: false });
        wx.showToast({ title: (e && e.message) || '刷新失败', icon: 'none' });
        return;
      }
      // WXML 里 failed 分支排在已登录内容与游客引导之前：请求失败只会看到重试块，
      // 不会掉回「登录后查看积分」（游客引导是最后兜底支，且只在未登录时可达）。
      this.setData({ loading: false, failed: true });
    }
  },

  onRetry() {
    this.fetch();
  },

  async onPullDownRefresh() {
    // 下拉刷新走静默：已有内容不闪骨架，完成（或失败）后收起下拉动画
    try {
      await this.fetch(true);
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  /** 游客点「登录后查看积分」：登录成功才拉汇总（不在进页时弹登录） */
  async onLoginTap() {
    if (await ensureLogin('登录后查看积分。')) this.fetch();
  },

  async onSignIn() {
    await this.post('/points/sign-in', '签到成功');
  },

  async onClaim(e) {
    const key = e.currentTarget.dataset.key;
    const task = this.data.taskGroups.onceTasks.concat(this.data.taskGroups.dailyTasks).find((t) => t.key === key);
    if (!task || task.disabled) return;
    if (key === 'daily_video') return this.watchVideo();
    await this.post(`/points/tasks/${key}/claim`, '领取成功');
  },

  /** okText 可传函数：按服务端响应拼文案（如视频任务用返回的 credited，不在端上写死分值） */
  async post(url, okText) {
    try {
      const data = await api.post(url);
      const text = typeof okText === 'function' ? okText(data) : okText;
      wx.showToast({ title: text, icon: 'success' });
      this.fetch();
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '操作失败', icon: 'none' });
    }
  },

  /**
   * 每日看视频：广告实例只创建一次；只有 onClose 回传 isEnded === true 才发分。
   * 提前关闭/广告拉取失败都不发分，onClose 监听用完即解绑（避免二次观看重复领）。
   */
  watchVideo() {
    if (this.data.videoBusy) return;
    const ad = this.ad || (this.ad = createRewardedAd());
    if (!ad) {
      wx.showToast({ title: '当前环境不支持广告', icon: 'none' });
      return;
    }
    const onClose = (res) => {
      ad.offClose(onClose);
      this.setData({ videoBusy: false });
      if (isAdRewardEligible(res)) {
        // 分值由服务端下发：只信 claim 返回的 credited，不在端上写死 +5
        this.post('/points/tasks/daily_video/claim', (data) => {
          const credited = (data && data.credited) || 0;
          return credited > 0 ? `积分 +${credited}` : '领取成功';
        });
      } else wx.showToast({ title: '未看完广告，本次不发积分', icon: 'none' });
    };
    const onFail = () => {
      ad.offClose(onClose);
      this.setData({ videoBusy: false });
      wx.showToast({ title: '广告加载失败，请稍后重试', icon: 'none' });
    };
    this.setData({ videoBusy: true });
    ad.onClose(onClose);
    ad.show().catch(() => ad.load().then(() => ad.show()).catch(onFail));
  },

  /**
   * 补某个漏签日（七格上的「补」字，或月历里点出来的 makeup 事件）：
   * 有卡 → 确认后 POST；无卡 → 落兑换页、不发请求。
   * 卡由服务端挑（spec §5.2），请求体只有 { dateKey }。
   * after 只有七格拿得到（服务端 cells 的 todayRewardAfter），月历点历史格时省略那半句。
   */
  askMakeup(dateKey, after) {
    if (!(this.data.cards > 0)) {
      this.goItem();
      return;
    }
    wx.showModal({
      title: '补签该日',
      // 日期用 md() 的 MM.DD 格式，不把 ISO 日期丢给用户看
      content: after
        ? `使用 1 张补签卡补签 ${md(dateKey)}？补完连签将重排，今天可拿 ${after} 分`
        : `使用 1 张补签卡补签 ${md(dateKey)}？补完连签会重新排`,
      success: (res) => {
        if (res && res.confirm) this.useMakeupCard(dateKey);
      },
    });
  },

  onMakeup(e) {
    const dateKey = e.currentTarget.dataset.dateKey;
    const cell = this.data.strip.find((c) => c.dateKey === dateKey);
    if (!cell || cell.state !== 'makeup') return;
    this.askMakeup(dateKey, cell.todayRewardAfter);
  },

  // ---------- 签到月历半屏 ----------

  openCalendar() {
    const month = currentMonth();
    this.setData({ calVisible: true, calMonth: month, calFailed: false });
    this.loadCalendar(month);
  },

  closeCalendar() {
    this.setData({ calVisible: false });
  },

  onCalMonthChange(e) {
    const month = e.detail.month;
    this.setData({ calMonth: month, calFailed: false });
    this.loadCalendar(month);
  },

  /** 只翻当月这一页数据：失败不顶掉整页，弹窗内出重试（同积分页其它局部降级） */
  async loadCalendar(month) {
    if (!month) return;
    this.setData({ calLoading: true, calFailed: false });
    try {
      const data = await api.get('/points/signin/calendar', { month });
      this.setData({ calLoading: false, calDays: (data && data.days) || [] });
    } catch (e) {
      this.setData({ calLoading: false, calFailed: true, calDays: [] });
    }
  },

  onCalRetry() {
    this.loadCalendar(this.data.calMonth);
  },

  /**
   * 月历里点漏签格：判据不在端上拦（2026-10-28 拍板），历史月的 missed 也照常发请求，
   * 由补签接口的 400 文案说清为什么不行——文案归服务端。
   */
  onCalMakeup(e) {
    const dateKey = e.detail && e.detail.dateKey;
    if (!dateKey) return;
    const cell = this.data.strip.find((c) => c.dateKey === dateKey);
    this.askMakeup(dateKey, cell && cell.todayRewardAfter);
  },

  /** 弹窗里点「今天」等价于页内那颗签到按钮——弹层遮住按钮时不能留死区 */
  onCalSignin() {
    this.onSignIn();
  },

  async useMakeupCard(dateKey) {
    if (this.makeupBusy) return;
    this.makeupBusy = true;
    try {
      const data = await api.post('/points/signin/makeup', { dateKey });
      const credited = (data && data.credited) || 0;
      const topped = (data && data.toppedUp) || 0;
      wx.showToast({
        title: topped > 0 ? `补签成功 +${credited}，另补发 ${topped} 分` : `补签成功 +${credited}`,
        icon: 'success',
      });
      await this.fetch();
    } catch (err) {
      // 400 的 message 原样 toast（文案归服务端，spec §5.3），成败都重拉让格子回到最新状态
      wx.showToast({ title: (err && err.message) || '补签失败', icon: 'none' });
      await this.fetch();
    } finally {
      this.makeupBusy = false;
    }
  },

  goRecords() {
    wx.navigateTo({ url: '/pages/points-records/points-records' });
  },

  // 兑换记录：进专页（我的订单 + 道具兑换记录），明细页筛 type=exchange 只有账本行、看不到卡状态与订单
  goExchangeRecords() {
    wx.navigateTo({ url: '/pages/points-exchanges/points-exchanges' });
  },

  goRules() {
    wx.navigateTo({ url: '/pages/points-rules/points-rules' });
  },

  /** 月历里的「兑换补签卡 ›」：显式带 key，不靠详情页回落第一项（后台多一件在架道具就会串页） */
  goMakeupItem() {
    wx.navigateTo({ url: '/pages/points-item/points-item?key=makeup_card' });
  },

  /**
   * 进商品详情：key 由卡片 data-key 回传（点哪张卡进哪件商品）。
   * 无参调用（补签时手里没卡，直接去兑换补签卡）不带 key，详情页回落第一项＝补签卡。
   */
  goItem(e) {
    const key = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key) || '';
    wx.navigateTo({ url: `/pages/points-item/points-item${key ? `?key=${key}` : ''}` });
  },
});

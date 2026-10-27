const api = require('../../services/api');
const { ensureLogin, waitSession } = require('../../utils/login-gate');
const { buildSigninStrip, buildTaskRows, buildItemCards, md } = require('../../utils/points-view');
const { createRewardedAd, isAdRewardEligible } = require('../../utils/rewarded-ad');
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
    streakText: '',
    taskGroups: { onceTasks: [], dailyTasks: [] },
    items: [],
    cards: 0,
    videoBusy: false,
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
      const signin = data.signin || {};
      const streakDay = Number(signin.streakDay) || 0;
      // 只格式化、不推导：位置/分值/可补性一律来自服务端 cells（spec §5.1），state==='makeup' 是唯一入口判据
      const cells = signin.cells || [];
      this.setData({
        loggedIn: true,
        loading: false,
        balance: data.balance ?? 0,
        signin,
        strip: buildSigninStrip(cells, bjDate(Date.now())),
        hasMakeup: cells.some((c) => c.state === 'makeup'),
        // 连签 ≥7 天七格全勾后，还要按需求 §4.2 显示「已连续 N 天 · 每日 7 分」
        streakText: streakDay >= 7 ? `已连续 ${streakDay} 天 · 每日 7 分` : '',
        taskGroups: buildTaskRows(data.tasks || []),
        items: buildItemCards(data.items),
        cards: signin.cards || 0,
      });
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
   * 补某个漏签日（直接点七格里的「补」字，dateKey 由 data-date-key 回传）：
   * 有卡 → 确认后 POST；无卡 → 落兑换页、不发请求。
   * 卡由服务端挑（spec §5.2），请求体只有 { dateKey }；可补判定的唯一来源是 cells 里的 makeup 格。
   */
  onMakeup(e) {
    const dateKey = e.currentTarget.dataset.dateKey;
    const cell = this.data.strip.find((c) => c.dateKey === dateKey);
    if (!cell || cell.state !== 'makeup') return;
    if (!(this.data.cards > 0)) {
      this.goItem();
      return;
    }
    wx.showModal({
      title: '补签该日',
      // 日期用七格 sub 的 MM.DD 格式，不打 ISO 日期给用户看；todayRewardAfter 由服务端 cells 下发
      content: `使用 1 张补签卡补签 ${md(dateKey)}？补完连签将重排，今天可拿 ${cell.todayRewardAfter} 分`,
      success: (res) => {
        if (res && res.confirm) this.useMakeupCard(dateKey);
      },
    });
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

  // 兑换记录：明细页带 type=exchange 筛选（2026-10-26）
  goExchangeRecords() {
    wx.navigateTo({ url: '/pages/points-records/points-records?type=exchange' });
  },

  goRules() {
    wx.navigateTo({ url: '/pages/points-rules/points-rules' });
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

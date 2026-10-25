const api = require('../../services/api');
const { ensureLogin } = require('../../utils/login-gate');
const { buildSigninStrip, buildTaskRows } = require('../../utils/points-view');
const { createRewardedAd, isAdRewardEligible } = require('../../utils/rewarded-ad');

Page({
  data: {
    loggedIn: false,
    loading: true,
    failed: false,
    balance: 0,
    signin: {},
    strip: [],
    tasks: [],
    item: null,
    cards: 0,
    videoBusy: false,
  },

  onLoad() {
    this.ad = null;
    this.fetch();
  },

  onShow() {
    if (this.data.loggedIn) this.fetch();
  },

  onUnload() {
    this.ad = null;
  },

  async fetch() {
    this.setData({ loading: true, failed: false });
    // 登录闸门走触点级：进页不自动弹登录，游客先看引导
    if (!getApp().globalData.loggedIn) {
      this.setData({ loading: false, loggedIn: false });
      return;
    }
    try {
      const data = await api.get('/points/summary');
      this.setData({
        loggedIn: true,
        loading: false,
        balance: data.balance ?? 0,
        signin: data.signin || {},
        strip: buildSigninStrip(data.signin || {}, Date.now()),
        tasks: buildTaskRows(data.tasks || []),
        item: data.item || null,
        cards: (data.signin && data.signin.cards) || 0,
      });
    } catch (e) {
      this.setData({ loading: false, failed: true });
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
    const task = this.data.tasks.find((t) => t.key === key);
    if (!task || task.disabled) return;
    if (key === 'daily_video') return this.watchVideo();
    await this.post(`/points/tasks/${key}/claim`, '领取成功');
  },

  async post(url, okText) {
    try {
      await api.post(url);
      wx.showToast({ title: okText, icon: 'success' });
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
      if (isAdRewardEligible(res)) this.post('/points/tasks/daily_video/claim', '积分 +5');
      else wx.showToast({ title: '未看完广告，本次不发积分', icon: 'none' });
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
   * 补签昨天：有可用卡时确认后直接 POST /points/cards/:id/use（不再跳商品页）；
   * 没有可用卡（旧服务/卡刚好过期）回落兑换页。
   */
  onMakeup() {
    const signin = this.data.signin || {};
    if (!signin.canMakeUp || !signin.makeupCardId) {
      this.goItem();
      return;
    }
    wx.showModal({
      title: '补签昨天',
      content: `使用 1 张补签卡补签 ${signin.makeupDate}？`,
      success: (res) => {
        if (res && res.confirm) this.useMakeupCard(signin.makeupCardId);
      },
    });
  },

  async useMakeupCard(cardId) {
    if (this.makeupBusy) return;
    this.makeupBusy = true;
    try {
      const data = await api.post(`/points/cards/${cardId}/use`);
      const credited = (data && data.credited) || 0;
      wx.showToast({ title: credited > 0 ? `补签成功 +${credited} 积分` : '补签成功', icon: 'success' });
      await this.fetch();
    } catch (e) {
      // 400 原样提示服务端文案（今天已签/卡已用/卡过期等），并刷新拿最新签到与卡状态
      wx.showToast({ title: (e && e.message) || '补签失败', icon: 'none' });
      if (e && e.statusCode === 400) await this.fetch();
    } finally {
      this.makeupBusy = false;
    }
  },

  goRecords() {
    wx.navigateTo({ url: '/pages/points-records/points-records' });
  },

  goRules() {
    wx.navigateTo({ url: '/pages/points-rules/points-rules' });
  },

  goItem() {
    wx.navigateTo({ url: '/pages/points-item/points-item' });
  },
});

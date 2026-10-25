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

  onMakeup() {
    wx.navigateTo({ url: `/pages/points-item/points-item?makeup=1` });
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

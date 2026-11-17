/**
 * 设置页（决策 F25）
 * 单位切换（公制/英制）、高精度定位开关 → PUT /users/me settings
 */
const api = require('../../services/api');
const storage = require('../../services/storage');
const { setAdFreeUntil } = require('../../utils/ad-free');
// 首页运动类型显示开关（纯前端，wx storage 存储，即时生效）
const sportDisplay = require('../../utils/sport-display');

Page({
  data: {
    // 运动类型显示与排序行：八个运动类型全展示，可拖 ≡ 排序、可开关收起
    sportTypeRows: sportDisplay.toggleRows(),
    dragIndex: -1, // 正在拖动的行下标（-1 = 未拖动）
    dragOffset: 0, // 拖动行相对其槽位的位移（px）
    settings: {
      unit: 'metric',
      highAccuracy: true,
      showBodyData: true,
      showSportData: true,
      privacyMode: false, // 隐私模式：榜单条目对他人匿名、资料卡对他人关闭
      kmAnnounce: true,
      dailyStepSync: true,
    },
    saving: false,
    loggedIn: false, // 登录态（决定是否展示退出登录入口）
    /** 游客态（2026-11-17）：需登录的设置项与保存按钮隐藏，只保留纯前端的运动类型设置 */
    notLoggedIn: false,
    photoQuota: null, // 照片额度用量（used/limit/remaining/percent/isMember），来自 /member/entitlements
  },

  onLoad() {
    this.setData({ sportTypeRows: sportDisplay.toggleRows() });
    this.loadSettings();
    this.refreshEntitlements();
  },

  /**
   * 会员是免广告的第二条来源：设置页顺带刷一次缓存，付完会员回来广告组件才会收掉。
   * 拉不到就沿用上次缓存，不打扰用户（权益读取失败按非会员降级由服务端保证）。
   */
  refreshEntitlements() {
    const token = storage.getToken();
    if (!(token && token.accessToken)) return;
    api.get('/member/entitlements').then((e) => {
      if (e && e.adFreeUntil) setAdFreeUntil(e.adFreeUntil);
      if (e && e.photoQuota) {
        const { used, limit, remaining } = e.photoQuota;
        this.setData({
          photoQuota: {
            used, limit, remaining,
            // 百分比只用于进度条宽度：端上不产出「额度文案」，文案仍由这里按读数拼展示句
            percent: limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0,
            isMember: !!e.memberActive,
          },
        });
      }
    }).catch(() => {});
  },

  /** 照片管理：额度用量 + 删除旧照片（删完额度即时回补） */
  goPhotos() {
    wx.navigateTo({ url: '/pages/photos/photos' });
  },

  async loadSettings() {
    // 游客态不请求：/users/me 需要登录，未登录必然 401（控制台报错 + 白发一次请求）
    const app = getApp();
    if (app.hasSession() && !app.globalData.loggedIn) {
      try {
        await app.login();
      } catch (e) {
        console.warn('静默登录失败', e);
      }
    }
    if (!app.hasSession() || !app.globalData.loggedIn) {
      this.setData({ loggedIn: false, notLoggedIn: true });
      return;
    }
    try {
      const user = await api.get('/users/me');
      this.setData({
        loggedIn: true, // 能拉到资料即已登录（游客态接口 401）
        notLoggedIn: false,
        settings: Object.assign(
          { unit: 'metric', highAccuracy: true, showBodyData: true, showSportData: true, privacyMode: false, kmAnnounce: true, dailyStepSync: true },
          user.settings,
        ),
      });
    } catch (e) {
      // 401 = 会话失效：按游客态处理，不当成加载失败
      if (e && (e.statusCode === 401 || e.code === 401)) {
        this.setData({ loggedIn: false, notLoggedIn: true });
        return;
      }
      console.error('加载设置失败', e);
      this.setData({ loggedIn: false });
    }
  },

  /** 行高 px（行高用 rpx 定义，触摸位移是 px，拖拽启动时按屏宽换算一次） */
  ensureRowHeight() {
    if (this._sportRowH) return this._sportRowH;
    const info = wx.getSystemInfoSync();
    // 与 settings.wxss .sport-type-row 的 height(rpx) 保持一致
    this._sportRowH = (info.windowWidth * 76) / 750;
    return this._sportRowH;
  },

  onDragStart(e) {
    const index = Number(e.currentTarget.dataset.index);
    this._dragAnchorY = e.touches[0].clientY;
    this._dragIndex = index;
    this.ensureRowHeight();
    this.setData({ dragIndex: index, dragOffset: 0 });
  },

  onDragMove(e) {
    if (this._dragIndex < 0) return;
    const rows = this.data.sportTypeRows;
    const rowH = this.ensureRowHeight();
    const y = e.touches[0].clientY;
    // 越过半行阈值就整行换位（live splice）：拖动行始终跟随手指，其余行按新顺序即时重排
    const steps = Math.trunc((y - this._dragAnchorY) / rowH);
    const target = Math.max(0, Math.min(rows.length - 1, this._dragIndex + steps));
    if (target !== this._dragIndex) {
      const next = rows.slice();
      const moved = next.splice(this._dragIndex, 1)[0];
      next.splice(target, 0, moved);
      this._dragIndex = target;
      this._dragAnchorY += steps * rowH; // 重锚：后续位移以新槽位为基准
      this.setData({ sportTypeRows: next });
    }
    this.setData({ dragOffset: y - this._dragAnchorY });
  },

  onDragEnd() {
    if (this._dragIndex < 0) return;
    // 落定：把最终顺序写进存储（顺序即首页网格顺序），清拖拽态
    sportDisplay.setOrder(this.data.sportTypeRows.map((r) => r.type));
    this._dragIndex = -1;
    this.setData({ dragIndex: -1, dragOffset: 0 });
  },

  // 运动类型显示开关：即时持久化（纯前端，不进 PUT /users/me），无需保存按钮
  onSportTypeToggle(e) {
    const type = e.currentTarget.dataset.type;
    const visible = !!e.detail.value;
    sportDisplay.setTypeVisible(type, visible);
    this.setData({
      sportTypeRows: sportDisplay.toggleRows(),
    });
  },

  onHighAccuracyChange(e) {
    this.setData({ 'settings.highAccuracy': e.detail.value });
  },

  onShowBodyDataChange(e) {
    this.setData({ 'settings.showBodyData': e.detail.value });
  },

  onKmAnnounceChange(e) {
    this.setData({ 'settings.kmAnnounce': e.detail.value });
  },

  onDailyStepSyncChange(e) {
    this.setData({ 'settings.dailyStepSync': e.detail.value });
  },

  /** 隐私模式：榜单条目对他人匿名、资料卡对他人关闭（即时改本地，随「保存」落库） */
  onPrivacyModeChange(e) {
    this.setData({ 'settings.privacyMode': !!e.detail.value });
  },


  /** 打开隐私政策 */
  /** 游客态点「微信一键登录」：登录成功后原地拉一次设置 */
  goLogin() {
    getApp()
      .login()
      .then(() => this.loadSettings())
      .catch((e) => wx.showToast({ title: (e && e.message) || '登录失败，请重试', icon: 'none' }));
  },

  /** 登录后回到本页自动补拉 */
  onShow() {
    const app = getApp();
    if (this.data.notLoggedIn && app.globalData.loggedIn) this.loadSettings();
  },

  openPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  async save() {
    // 游客态保存无意义（按钮已隐藏，这里是兜底，防止其它路径触发）
    if (this.data.notLoggedIn) {
      this.goLogin();
      return;
    }
    if (this.data.saving) return;
    this.setData({ saving: true });
    try {
      const saved = await api.put('/users/me', { settings: this.data.settings });
      wx.showToast({ title: '已保存', icon: 'success' });
      // 同步全局（my 页身高体重展示开关即时生效）
      const app = getApp();
      if (app.globalData.userInfo) {
        app.globalData.userInfo.settings = saved.settings || this.data.settings;
      }
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' });
      console.error(e);
    } finally {
      this.setData({ saving: false });
    }
  },
});

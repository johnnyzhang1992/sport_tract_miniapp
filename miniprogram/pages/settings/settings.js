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
      kmAnnounce: true,
      dailyStepSync: true,
    },
    saving: false,
    loggedIn: false, // 登录态（决定是否展示退出登录入口）
    sportSheetVisible: false, // 关闭「展示运动数据」后的提示半屏
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

  /** 退出登录：清本地令牌回游客态（云端数据保留，重新登录可同步） */
  logout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后清空本地登录状态，你的运动数据仍保留在云端，重新登录即可同步回来。',
      confirmText: '退出',
      confirmColor: '#e34d59',
      success: (res) => {
        if (!res.confirm) return;
        getApp().logout();
        wx.showToast({ title: '已退出登录', icon: 'success' });
        setTimeout(() => wx.switchTab({ url: '/pages/my/my' }), 600);
      },
    });
  },

  async loadSettings() {
    try {
      const user = await api.get('/users/me');
      this.setData({
        loggedIn: true, // 能拉到资料即已登录（游客态接口 401）
        settings: Object.assign(
          { unit: 'metric', highAccuracy: true, showBodyData: true, showSportData: true, kmAnnounce: true, dailyStepSync: true },
          user.settings,
        ),
      });
    } catch (e) {
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

  /** 关闭「展示运动数据」：弹半屏解释影响范围；重新打开则收起 */
  onShowSportDataChange(e) {
    const value = !!e.detail.value;
    this.setData({
      'settings.showSportData': value,
      sportSheetVisible: value ? false : true,
    });
  },

  closeSportSheet() {
    this.setData({ sportSheetVisible: false });
  },

  noop() {},

  /** 打开隐私政策 */
  openPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  async save() {
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

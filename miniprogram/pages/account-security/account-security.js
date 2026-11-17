/**
 * 账号与安全（2026-11-17）
 *
 * 两张卡：
 *   1. 退出登录——从「设置」页移过来的（原来在设置页底部）
 *   2. 注销账号——清空全部数据，需二次确认
 *
 * 注销为什么这么重：不可恢复。所以做三层确认——
 *   ① 卡片上先说清后果（清空哪些数据）
 *   ② 点「注销账号」弹窗，要求**输入当前昵称**（宽松匹配：忽略首尾空格与大小写）
 *   ③ 服务端再校验一次（前端校验只是为了早提示，安全靠服务端）
 * 昵称为空的老账号，改为输入固定词「注销」。
 */
const api = require('../../services/api');

/** 与服务端 EMPTY_NICKNAME_CONFIRM_WORD 保持一致 */
const EMPTY_NICKNAME_WORD = '注销';

Page({
  data: {
    /** 当前昵称（确认词基准） */
    nickname: '',
    /** 注销确认弹窗 */
    confirmVisible: false,
    /** 用户输入的确认词 */
    confirmInput: '',
    /** 输入是否与昵称匹配（决定「确认注销」按钮可用） */
    confirmOk: false,
    /** 服务端提示（如昵称不匹配） */
    confirmError: '',
    /** 提交中：禁用按钮防重复 */
    submitting: false,
    /** 游客态：退出与注销都需要登录，未登录时整页换成登录引导（2026-11-17） */
    notLoggedIn: false,
  },

  onLoad() {
    this.loadProfile();
  },

  /** 取当前昵称作为确认词基准；失败不阻断页面（注销时服务端还会校验） */
  async loadProfile() {
    // 游客态不请求：/users/me 需要登录，未登录必然 401（控制台报错 + 白发一次请求）。
    // 已注册用户先静默恢复会话（与首页/我的页一致）。
    const app = getApp();
    if (app.hasSession() && !app.globalData.loggedIn) {
      try {
        await app.login();
      } catch (e) {
        console.warn('静默登录失败', e);
      }
    }
    if (!app.hasSession() || !app.globalData.loggedIn) {
      this.setData({ notLoggedIn: true });
      return;
    }
    this.setData({ notLoggedIn: false });
    try {
      const me = await api.get('/users/me');
      this.setData({ nickname: (me && me.nickname) || '' });
      this.recheck();
    } catch (e) {
      // 401 = 会话失效：按游客态处理，不显示「读取失败」
      if (e && (e.statusCode === 401 || e.code === 401)) {
        this.setData({ notLoggedIn: true });
        return;
      }
      console.warn('读取资料失败', e);
    }
  },

  /** 游客态点「微信一键登录」：登录成功后原地拉一次资料 */
  goLogin() {
    getApp()
      .login()
      .then(() => this.loadProfile())
      .catch((e) => wx.showToast({ title: (e && e.message) || '登录失败，请重试', icon: 'none' }));
  },

  /** 从别处登录后回到本页自动补拉 */
  onShow() {
    const app = getApp();
    if (this.data.notLoggedIn && app.globalData.loggedIn) this.loadProfile();
  },

  /* ── 退出登录 ───────────────────────────────── */

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

  /* ── 注销账号 ───────────────────────────────── */

  openDeactivate() {
    this.setData({ confirmVisible: true, confirmInput: '', confirmOk: false, confirmError: '' });
  },

  closeDeactivate() {
    if (this.data.submitting) return; // 提交中不允许关闭，避免状态错乱
    this.setData({ confirmVisible: false });
  },

  /** 输入变化 → 实时判断是否匹配（用事件里的值直接算，不依赖 data 是否已更新） */
  onConfirmInput(e) {
    const input = (e && e.detail && e.detail.value) || '';
    this.setData({ confirmInput: input, confirmError: '', confirmOk: this.matchNickname(input) });
  },

  /** 依据当前 data 重算（昵称异步加载完成后调用） */
  recheck() {
    this.setData({ confirmOk: this.matchNickname(this.data.confirmInput) });
  },

  /**
   * 宽松匹配：忽略首尾空格与大小写。
   * 昵称为空（从没设过）→ 要求输入「注销」。
   * 抽出纯计算函数，避免「setData 回调里读 data 读到旧值」这类时序坑。
   */
  matchNickname(input) {
    const got = String(input || '').trim().toLowerCase();
    const want = String(this.data.nickname || '').trim().toLowerCase();
    return want ? got === want : got === EMPTY_NICKNAME_WORD;
  },

  async submitDeactivate() {
    if (this.data.submitting) return;
    if (!this.data.confirmOk) {
      this.setData({ confirmError: this.data.nickname ? '昵称不匹配，请重新输入' : `请输入「${EMPTY_NICKNAME_WORD}」确认` });
      return;
    }
    this.setData({ submitting: true, confirmError: '' });
    try {
      await api.post('/users/me/deactivate', { confirm: this.data.confirmInput });
      // 账号已删：清本地登录态并回首页（不能再留在需要登录的页面上）
      getApp().logout();
      this.setData({ confirmVisible: false });
      wx.showToast({ title: '账号已注销', icon: 'success' });
      setTimeout(() => wx.switchTab({ url: '/pages/index/index' }), 800);
    } catch (e) {
      const msg = (e && (e.message || e.errMsg)) || '注销失败，请重试';
      this.setData({ confirmError: msg, submitting: false });
    }
  },

  noop() {},
});
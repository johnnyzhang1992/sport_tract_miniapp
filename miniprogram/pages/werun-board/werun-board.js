/**
 * 微信步数排行榜（docs/20-微信步数接口调研.md）：日/周/月/年四周期 × 全国/按省 × TOP50 + 我的真实排名。
 * 页面形态对齐运动榜（pages/leaderboard）：周期分段选择、省份 picker、「上一期/下一期」翻历史周期、
 * 前三名奖牌、游客可看榜（登录后才有「我的排名」）。差异：无运动类型 chips / 本榜最佳 / 点亮地图，
 * 指标只有步数；行内暂不接公开资料半屏（后续要挂时复用 /stats/profile/:uid）。
 * 省份口径 = 用户最近一次登录的归属地（服务端聚合，见 sport_track_api services/werun-board.ts）。
 */
const { initialOf, formatThousands } = require('../../utils/format.js');
const { syncWeRunSteps, getWeRunAuthState, openWeRunSetting } = require('../../utils/werun');

const GENDER_ICONS = {
  0: '/assets/icons/gender-secret.png',
  1: '/assets/icons/gender-male.png',
  2: '/assets/icons/gender-female.png',
};

const PERIODS = [
  { key: 'day', label: '日榜' },
  { key: 'week', label: '周榜' },
  { key: 'month', label: '月榜' },
  { key: 'year', label: '年榜' },
];

/** 头像：OSS 签名 URL 优先 → 预设头像本地资源 → 昵称首字 */
function avatarOf(r) {
  return {
    avatarSrc: r.avatarUrl || (r.avatarPreset ? `/assets/avatars/${r.avatarPreset}.png` : ''),
    avatarText: initialOf(r.name, '迹'),
    member: !!r.memberActive,
  };
}

/** 行装饰：性别图标 + 前三名奖牌 + 头像（TOP 与「我的排名」共用） */
function decorateRows(board) {
  if (!board) return board;
  const deco = (r) => ({
    ...r,
    genderIcon: GENDER_ICONS[r.gender] || GENDER_ICONS[0],
    medalIcon: r.rank <= 3 ? `/assets/icons/rank-medal-${r.rank}.png` : '',
    stepText: formatThousands(r.step),
    ...avatarOf(r),
  });
  return { ...board, top: (board.top || []).map(deco), me: board.me ? deco(board.me) : null };
}

Page({
  data: {
    loggedIn: false,
    loading: true,
    periods: PERIODS,
    periodIndex: 0, // 默认日榜
    periodWindow: null,
    prevPeriodKey: null,
    nextPeriodKey: null,
    periodKey: '', // 空＝当前期；翻历史周期时写入
    provinceOptions: ['全国'],
    provinceIndex: 0,
    board: null, // { players, top, me, window, prevPeriodKey, nextPeriodKey }
    weRunAuth: '', // 'granted' | 'denied' | 'unasked' | 'privacy' | ''（未查）
    syncing: false, // 同步中（顶栏按钮防重复点）
  },

  onLoad() {
    this.refresh();
  },

  onShow() {
    // 返回本页时静默刷新（保留当前周期/省份选择）
    if (this._loaded) this.refresh(true);
    // 进入页面即检查微信运动授权：未开启/未授权就引导（每次进入都查状态，但弹窗每天最多一次）
    this.checkWeRunAuth();
  },

  /**
   * 微信运动授权前置检查（2026-11-05）：
   * - 已授权：静默同步一趟（把今天的步数补进来，失败不打扰）
   * - 未授权/曾拒绝：弹窗引导去开启；用户「暂不」就记住当天不再弹，
   *   页面上留一条可点提示条（横幅），想开随时点
   * - 游客不弹：先登录才有 userId 可落库
   */
  async checkWeRunAuth() {
    const app = getApp();
    if (!app.globalData.loggedIn) {
      this.setData({ weRunAuth: '' });
      return;
    }
    const state = await getWeRunAuthState();
    this.setData({ weRunAuth: state });
    if (state === 'granted') {
      this.silentSync();
      return;
    }
    if (this.promptedToday()) return; // 每天最多打扰一次
    this.promptWeRunAuth(state);
  },

  /** 当天是否已经弹过引导（避免每次进页都弹） */
  promptedToday() {
    const day = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
    try {
      return wx.getStorageSync('werun_auth_prompted') === day;
    } catch (e) {
      return false;
    }
  },

  markPrompted() {
    const day = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
    try {
      wx.setStorageSync('werun_auth_prompted', day);
    } catch (e) {
      // 存储失败不影响功能：只是可能多弹一次
    }
  },

  /** 弹窗引导：曾拒绝 → 只能去设置页；没问过 → 直接授权弹窗；隐私未同意 → 先过隐私 */
  promptWeRunAuth(state) {
    this.markPrompted();
    const deniedBefore = state === 'denied';
    wx.showModal({
      title: '开启微信运动',
      content: deniedBefore
        ? '你之前拒绝了微信运动授权。排行榜要读取步数才能参与排名，去设置里打开「微信运动」即可。'
        : '步数排行榜需要读取你的微信运动步数（仅用于排名展示）。开启后步数会自动同步进来。',
      confirmText: deniedBefore ? '去设置' : '去开启',
      cancelText: '暂不',
      success: (res) => {
        if (!res.confirm) return;
        if (deniedBefore) this.openSettingAndSync();
        else this.grantAndSync();
      },
    });
  },

  /** 首次授权：拉起隐私/授权弹窗，成功后同步 */
  async grantAndSync() {
    const r = await syncWeRunSteps({ requestAuth: true });
    await this.afterSync(r);
  },

  /** 曾拒绝：只能进设置页手动打开 */
  async openSettingAndSync() {
    const granted = await openWeRunSetting();
    if (!granted) {
      wx.showToast({ title: '未开启微信运动授权', icon: 'none' });
      return;
    }
    this.setData({ weRunAuth: 'granted' });
    const r = await syncWeRunSteps();
    await this.afterSync(r);
  },

  /** 同步结果统一处理：成功刷新榜单，各类失败给可读提示（文案不吞） */
  async afterSync(r) {
    if (r.ok) {
      wx.showToast({ title: `已同步 ${r.syncedDays} 天步数`, icon: 'none' });
      await this.refresh(true);
      return;
    }
    if (r.reason === 'disabled') {
      wx.showModal({
        title: '微信运动未开启',
        content: '需要先在微信里开启「微信运动」功能（微信 → 我 → 设置 → 通用 → 辅助功能），开启后回来重新点一次。',
        showCancel: false,
      });
      return;
    }
    if (r.reason === 'denied') {
      this.setData({ weRunAuth: 'denied' });
      wx.showToast({ title: '未授权，无法同步步数', icon: 'none' });
      return;
    }
    if (r.reason === 'privacy-denied') {
      wx.showToast({ title: '需同意隐私协议才能同步', icon: 'none' });
      return;
    }
    if (r.reason === 'busy') return; // 已有一趟在跑，静默跳过
    wx.showToast({ title: r.message || '同步失败，请稍后再试', icon: 'none' });
  },

  /**
   * 已授权时的静默同步：正常路径不弹窗、不 toast（失败只留日志）。
   * 唯一例外＝「微信运动功能没开」（reason=disabled）：这不是网络抖动，用户不处理就永远没数据，
   * 必须明确告知一次（每天最多一次，避免每次进页都弹）。
   */
  async silentSync() {
    if (this.data.syncing) return;
    this.setData({ syncing: true });
    try {
      const r = await syncWeRunSteps();
      if (r.ok && r.syncedDays > 0) await this.refresh(true);
      else if (!r.ok && r.reason === 'disabled' && !this.disabledPromptedToday()) {
        this.markDisabledPrompted();
        wx.showModal({
          title: '微信运动未开启',
          content: '需要先在微信里开启「微信运动」功能（微信 → 我 → 设置 → 通用 → 辅助功能），开启后回来下拉刷新即可同步。',
          showCancel: false,
        });
      }
    } catch (e) {
      console.warn('[werun-board] 静默同步失败', e);
    } finally {
      this.setData({ syncing: false });
    }
  },

  /** 「微信运动没开」的提示每天最多一次（与授权引导分开记，因为它的解决办法在微信设置里） */
  disabledPromptedToday() {
    const day = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
    try {
      return wx.getStorageSync('werun_disabled_prompted') === day;
    } catch (e) {
      return false;
    }
  },

  markDisabledPrompted() {
    const day = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
    try {
      wx.setStorageSync('werun_disabled_prompted', day);
    } catch (e) {
      // 存不下就多发一次提示，不影响功能
    }
  },

  /** 顶部提示条点击：按当前授权态走对应引导 */
  onTapAuthBanner() {
    if (this.data.syncing) return;
    if (this.data.weRunAuth === 'denied') this.openSettingAndSync();
    else this.grantAndSync();
  },

  async refresh(silent = false) {
    const app = getApp();
    if (app.hasSession && app.hasSession() && !app.globalData.loggedIn) {
      try { await app.login(); } catch (e) { console.warn('静默登录失败', e); }
    }
    const loggedIn = !!app.globalData.loggedIn;
    // 游客也拉榜单（与运动榜同口径：接口可选鉴权，me 为 null 时不渲染「我的排名」卡）
    this.setData({ loggedIn, loading: !silent });
    try {
      const [provincesRes, boardRaw] = await Promise.all([
        getApp().globalData.api.get('/werun/board-provinces').catch(() => ({ provinces: [] })),
        getApp().globalData.api.get(this.boardQuery()),
      ]);
      this.setData({
        board: decorateRows(boardRaw),
        provinceOptions: ['全国', ...(provincesRes.provinces || []).map((p) => p.name)],
      });
      this.applyWindow(boardRaw);
      this._loaded = true;
      if (this.data.loading) this.setData({ loading: false });
    } catch (e) {
      console.error('[werun-board] 加载失败', e);
      this.setData({ loading: false });
      if (!silent) wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  boardQuery() {
    const key = this.data.periodKey ? `&periodKey=${encodeURIComponent(this.data.periodKey)}` : '';
    return `/werun/board?period=${this.curPeriod()}&province=${encodeURIComponent(this.curProvince())}${key}`;
  },

  curPeriod() {
    return this.data.periods[this.data.periodIndex].key;
  },

  curProvince() {
    return this.data.provinceOptions[this.data.provinceIndex] || '全国';
  },

  /** 把服务端下发的期信息落到页面状态（翻页按钮可用性由 prev/nextPeriodKey 决定） */
  applyWindow(board) {
    const w = (board && board.window) || null;
    const next = (board && board.nextPeriodKey) || null;
    this.setData({
      periodWindow: w,
      prevPeriodKey: (board && board.prevPeriodKey) || null,
      nextPeriodKey: next,
      // 已回到最新一期：清空 periodKey，之后跟随 now（否则跨期后会停在旧的「当前期」）
      ...(w && next === null ? { periodKey: '' } : {}),
      loading: false,
    });
  },

  onPeriodTap(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (index === this.data.periodIndex) return;
    // 换周期必须清掉 periodKey：日键 YYYY-MM-DD 拿去当月榜键会被 400 拒掉
    this.setData({ periodIndex: index, periodKey: '', periodWindow: null, prevPeriodKey: null, nextPeriodKey: null });
    this.fetchBoard();
  },

  onPrevPeriod() {
    if (!this.data.prevPeriodKey) return;
    this.setData({ periodKey: this.data.prevPeriodKey });
    this.fetchBoard();
  },

  onNextPeriod() {
    if (!this.data.nextPeriodKey) return;
    this.setData({ periodKey: this.data.nextPeriodKey });
    this.fetchBoard();
  },

  onProvinceChange(e) {
    this.setData({ provinceIndex: Number(e.detail.value) });
    this.fetchBoard();
  },

  async fetchBoard() {
    try {
      const boardRaw = await getApp().globalData.api.get(this.boardQuery());
      this.setData({ board: decorateRows(boardRaw) });
      this.applyWindow(boardRaw);
    } catch (e) {
      console.error('[werun-board] 排行加载失败', e);
      wx.showToast({ title: '排行加载失败', icon: 'none' });
    }
  },

  async guestLogin() {
    try {
      await getApp().login();
      this.refresh();
    } catch (e) {
      wx.showToast({ title: '登录失败', icon: 'none' });
    }
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh());
  },

  onShareAppMessage() {
    const label = this.data.periods[this.data.periodIndex].label;
    return {
      title: `微信步数${label} · 看看谁走得多`,
      path: '/pages/werun-board/werun-board',
    };
  },
});

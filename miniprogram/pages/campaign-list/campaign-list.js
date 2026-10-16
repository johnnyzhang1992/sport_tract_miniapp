// 一起运动活动列表页（首页「查看全部」进）：我参与 / 我发起两个 Tab + 卡片列表 + 右下角悬浮「＋发起」。
// 接口：GET /campaigns?role=created|joined → { items:[{ id, title, visibility, startAt, endAt, status, myStats }],
//                                                     total, page, pageSize }（需登录）
// - status 是服务端已派生的档位（active/ended/dissolved），端上不按 endAt 二次计算，免口径分叉；
// - 列表 DTO 没有 myState（R23）：卡片不做「已退出 / 已被移出」标注，那是详情页的职责；
// - myStats 只有 { count, distance, duration }（没有 streak，连续天数只在详情 myPanel 里）。
const api = require('../../services/api');
const { statusLabel, statusTagClass, fmtRangeLabeled, avatarStack, fmtPanel } = require('../../utils/campaign.js');

// 两个 Tab：key 与接口 role 参数一一对应（没有活动广场，只能看到自己相关的活动）
// 「我参与」在前并作为默认档（多数人是参与者；进页首个请求即 role=joined）
const TABS = [
  { key: 'joined', label: '我参与的' },
  { key: 'created', label: '我发起的' },
];

/** 卡片展示字段在 JS 侧一次算好（WXML 不做格式化）：带标签的时间行 + 成员面 + 我的汇总 */
function toCard(c) {
  const p = fmtPanel(c.myStats || {});
  return Object.assign({}, c, {
    timeText: fmtRangeLabeled(c.startAt, c.endAt),
    statusText: statusLabel(c.status),
    statusTag: statusTagClass(c.status),
    memberText: `${c.memberCount || 0} 人已加入`,
    avatarList: avatarStack(c.memberAvatars), // 头像为排行榜（距离）前三，签名 url 优先
    statsText: `我的运动 ${p.countText} 次 · ${p.distanceText} km · ${p.durationText}`,
  });
}

Page({
  data: {
    loggedIn: false,
    loading: true,
    tab: 'joined', // joined | created（默认「我参与」，见 TABS）
    tabs: TABS,
    items: [],
    error: '', // 首屏加载失败的原因（屏上还有内容时刷新失败只 toast，不整页报错）
  },

  onLoad() {
    this.setData({ loggedIn: !!getApp().globalData.loggedIn });
    this.refresh();
  },

  onShow() {
    // 切回本页（创建 / 详情返回）静默刷新，保留当前 Tab；首屏由 onLoad 拉，不重复
    if (this._loaded) this.refresh(true);
  },

  /** 登录态对齐 + 拉当前 Tab 的列表（onLoad / onShow / 切 Tab / 下拉刷新共用） */
  async refresh(silent = false) {
    const app = getApp();
    // 本地有 token 的老用户先静默恢复；仍是游客就一个请求都不发（/campaigns 必 401）
    if (app.hasSession() && !app.globalData.loggedIn) {
      try {
        await app.login();
      } catch (e) {
        console.warn('[campaign-list] 静默登录失败', e);
      }
    }
    const loggedIn = !!app.globalData.loggedIn;
    // 仅首屏进 loading 态：刷新/切 Tab 时已有内容先留在屏上（数据到了再整体换），防闪屏
    this.setData({ loggedIn, loading: !silent && loggedIn && this.data.items.length === 0, error: '' });
    if (!loggedIn) return;
    // 请求序号守卫：只应用最后一次结果，防竞态（切 Tab 时旧包不能盖到新档的 Tab 下）
    const seq = (this._seq = (this._seq || 0) + 1);
    const role = this.data.tab; // 发起时的档位：响应回来时若已切档则丢弃
    try {
      const data = await api.get(`/campaigns?role=${role}`);
      if (seq !== this._seq || role !== this.data.tab) return;
      this.setData({ items: (data.items || []).map(toCard), loading: false });
      this._loaded = true;
    } catch (e) {
      if (seq !== this._seq || role !== this.data.tab) return;
      console.error('[campaign-list] 加载失败', e);
      const empty = this.data.items.length === 0;
      // 首屏失败：整页错误态 + 重试；已有内容：静默保住旧列表，非静默（下拉/切 Tab）才 toast
      this.setData({ loading: false, error: empty ? (e && e.message) || '加载失败' : '' });
      if (!silent && !empty) wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
    }
  },

  /** 切「我发起 / 我参与」：两 Tab 口径不同，清掉旧卡片再拉，避免短暂展示另一个口径的数据 */
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (!tab || tab === this.data.tab) return;
    this.setData({ tab, items: [] });
    this.refresh();
  },

  /** 首屏失败重试 */
  retry() {
    return this.refresh();
  },

  /** 游客登录（页面内引导） */
  async guestLogin() {
    try {
      await getApp().login();
      this.refresh();
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '登录失败', icon: 'none' });
    }
  },

  /** 点卡片 → 活动详情页 */
  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/campaign-detail/campaign-detail?id=${id}` });
  },

  /** 右下角「＋发起」→ 创建活动页（登录闸门在创建页内） */
  goCreate() {
    wx.navigateTo({ url: '/pages/campaign-create/campaign-create' });
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh());
  },
});

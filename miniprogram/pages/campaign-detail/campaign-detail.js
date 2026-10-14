// 活动详情页（列表卡片 / 小程序码 / 分享卡片进）。
//
// 接口与身份分流（服务端已按身份裁剪，端上不再二次判断可见性）：
//   GET /campaigns/:id            → 两条身份分支都回 标题/时间/可见性/白名单/人数上限/status/creatorId/myState/canJoin；
//                                   **只有 myState === 'joined'** 才多出 totals / members / myPanel。
//   GET /campaigns/:id/leaderboard → 仅成员（非成员服务端 403，需求 §5 总则：成员数据不外泄）
//                                   → 所以只在 joined 分支里请求它。
// 需求 R23/R27：详情页是唯一能把「非 joined 身份」说清楚的地方（列表 DTO 没有 myState），
//   pending / removed / left 各要有身份说明行（identity note）+ joinCta 按钮（desc 见 utils/campaign.js）。
// status 是服务端派生的档位（active/ended/dissolved），端上**不**按 endAt 重算，免口径分叉。
const api = require('../../services/api');
const config = require('../../config/index');
const { statusLabel, visibilityLabel, fmtRange, joinCta, fmtPanel } = require('../../utils/campaign.js');

/** 运动类型 key → 中文名（与创建页 / 服务端白名单同一集合，取 config 这一份） */
const TYPE_LABEL = {};
(config.ACTIVITY_TYPES || []).forEach((t) => { TYPE_LABEL[t.type] = t.label; });

/**
 * 身份说明行（R27）：说清「现在是什么状态」。与 joinCta 按钮互补——按钮只说「下一步能做什么」。
 * 只有详情页展示 myState，故这三句只住在本页，不进 utils/campaign.js（那里是各页共用的标签与按钮文案）。
 */
const STATE_NOTE = {
  pending: '你的加入申请已提交，等待发起人同意',
  removed: '你已被移出该活动，无法再申请加入',
  left: '你已退出该活动',
};

/** 顶部信息（时间/状态/可见性/上限/类型白名单都在 JS 侧算好，WXML 不做格式化） */
function toHead(d) {
  return {
    title: d.title,
    description: d.description || '',
    rangeText: fmtRange(d.startAt, d.endAt),
    statusText: statusLabel(d.status),
    visibilityText: visibilityLabel(d.visibility),
    limitText: d.memberLimit == null ? '不限人数' : `上限 ${d.memberLimit} 人`,
    typesText: (d.allowedTypes || []).length
      ? d.allowedTypes.map((t) => TYPE_LABEL[t] || t).join(' / ')
      : '不限运动类型',
  };
}

/** 排行榜行 → 成员列表行（名次 / 头像 / 昵称 / 距离 / 次数 / 时长）；头像三级兜底同运动榜 */
function toMemberRow(r) {
  const p = fmtPanel({ count: r.count, distance: r.distance, duration: r.duration });
  return {
    userId: r.userId,
    rank: r.rank,
    name: r.name || '微信用户',
    medalIcon: r.rank <= 3 ? `/assets/icons/rank-medal-${r.rank}.png` : '',
    avatarSrc: r.avatarUrl || (r.avatarPreset ? `/assets/avatars/${r.avatarPreset}.png` : ''),
    avatarText: (r.name || '迹')[0],
    distanceText: p.distanceText,
    countText: p.countText,
    durationText: p.durationText,
  };
}

Page({
  data: {
    loading: true,
    notFound: false, // 活动不存在（id 解不出 / 服务端 404）
    error: '', // 首屏加载失败原因（屏上错误态 + 重试）
    head: null, // 顶部信息
    isMember: false, // myState === 'joined'
    cta: null, // joinCta 结果（成员为 null）
    ctaHint: '', // 按钮下方的显式提示（可点 / 不可点）
    stateNote: '', // 身份说明行
    totals: null, // 全队汇总（仅成员）
    members: [], // 成员列表＝排行榜行（仅成员）
    panel: null, // 底部悬浮面板：我的 myPanel
    // 成员信息半屏（非发起人视角只读；发起人视角由 Task 11 补）
    sheetVisible: false,
    sheetMember: null,
  },

  onLoad(options) {
    this._id = this.resolveId(options || {});
    if (!this._id) {
      this.setData({ loading: false, notFound: true });
      return;
    }
    this.refresh();
  },

  /**
   * 活动 id：普通跳转走 `options.id`，小程序码走 `options.scene`（扫码进页面只有 scene）。
   * `decodeURIComponent` 遇到畸形串（外部输入里夹一个裸 `%`）会抛 URIError —— 不兜住整页会崩，
   * 所以 try/catch 退回空串，由调用方走「活动不存在」态。
   */
  resolveId(options) {
    if (options.id) return String(options.id);
    try {
      return decodeURIComponent(options.scene || '');
    } catch (e) {
      console.warn('[campaign-detail] scene 解析失败', options.scene, e);
      return '';
    }
  },

  onShow() {
    // 从成员明细 / 审批弹窗返回时静默刷新（首屏由 onLoad 拉，不重复）
    if (this._loaded) this.refresh(true);
  },

  /** 拉详情（+ 成员时再拉排行榜）。silent：已有内容时刷新不整屏 loading，防闪屏 */
  async refresh(silent = false) {
    const id = this._id;
    if (!id) return;
    // 请求序号守卫（R25）：onShow 与下拉刷新可能并发，只允许最后一次的响应落地
    const seq = (this._seq = (this._seq || 0) + 1);
    if (!this.data.head) this.setData({ loading: !silent });

    let detail;
    try {
      detail = await api.get(`/campaigns/${id}`);
    } catch (e) {
      if (seq !== this._seq) return;
      console.error('[campaign-detail] 加载失败', e);
      // 静默：屏上给错误态（首屏）或保住旧内容（刷新），不弹 toast 打断
      const empty = !this.data.head;
      this.setData({
        loading: false,
        notFound: !!(e && e.statusCode === 404),
        error: empty && e && e.statusCode !== 404 ? (e.message || '加载失败') : '',
      });
      return;
    }
    if (seq !== this._seq) return;

    // 排行榜只对成员拉：非成员服务端 403；失败不拖垮整页（成员列表退化为空，底部面板仍用 myPanel）
    let board = null;
    if (detail.myState === 'joined') {
      board = await api.get(`/campaigns/${id}/leaderboard`).catch((e) => {
        console.warn('[campaign-detail] 排行榜加载失败', e);
        return null;
      });
      if (seq !== this._seq) return;
    }

    this.applyDetail(detail, board);
    this._loaded = true;
  },

  /** 详情（+ 排行榜）→ 视图：一处分流，避免 WXML 里散落身份判断 */
  applyDetail(detail, board) {
    const isMember = detail.myState === 'joined';
    const rows = board && Array.isArray(board.rows) ? board.rows : [];
    const cta = joinCta({
      myState: detail.myState,
      canJoin: detail.canJoin,
      status: detail.status,
      visibility: detail.visibility,
    });
    this.setData({
      loading: false,
      notFound: false,
      error: '',
      head: toHead(detail),
      isMember,
      cta,
      ctaHint: cta ? (cta.disabled ? '当前不可加入' : `点击「${cta.text}」`) : '',
      stateNote: STATE_NOTE[detail.myState] || '',
      totals: isMember && detail.totals ? fmtPanel(detail.totals) : null,
      members: isMember ? rows.map(toMemberRow) : [],
      panel: isMember && detail.myPanel ? fmtPanel(detail.myPanel) : null,
      // 身份可能已变（加入成功 / 被移出）：旧成员的半屏不能停在过期数据上
      sheetVisible: false,
      sheetMember: null,
    });
  },

  /** 首屏失败重试 */
  retry() {
    this.setData({ loading: true, error: '' });
    return this.refresh();
  },

  /**
   * 加入 / 申请（公开直接加入、隐私变待审批，服务端判）。
   * disabled（等待同意 / 已被移出 / 已满 / 已结束 / 已解散）时按钮不响应。
   */
  async onJoin() {
    const cta = this.data.cta;
    if (!cta || cta.disabled || this._joining) return;
    // 连点守卫：await 之前置位，避免一次点击发两次请求
    this._joining = true;
    try {
      await api.post(`/campaigns/${this._id}/join`, {});
      wx.showToast({ title: cta.text + '成功', icon: 'success' });
      await this.refresh(true);
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '操作失败', icon: 'none' });
    } finally {
      this._joining = false;
    }
  },

  /** 点成员行 → 只读成员信息半屏（数据是已在手的排行榜行，不发明细请求） */
  openMember(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const member = this.data.members[idx];
    if (!member) return;
    this.setData({ sheetVisible: true, sheetMember: member });
  },

  closeMemberSheet() {
    this.setData({ sheetVisible: false });
  },

  onPullDownRefresh() {
    this.refresh(true).finally(() => wx.stopPullDownRefresh());
  },
});

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
//
// 发起人专属（Task 11）：
//   GET /:id/pending（非发起人 403）、POST /:id/approve|reject|kick、DELETE /:id —— 身份判否时这些
//   请求一个都不发（服务端 403 是兜底，需求 §5「他人数据不外泄」要求端上也不去碰）。
//   成员明细（GET /:id/members/:uid）不在此列：它对**活动内成员**开放（队友与本人同样可看），
//   服务端闸门是「viewer 当前是不是 joined 成员」，非成员才 403。明细行不可点，只到汇总级数据。
//   踢人 / 解散是破坏性操作：wx.showModal 二次确认后才发请求，取消＝零请求；成功后静默刷新。
//   小程序码（POST /campaigns/mini-code，仅 joined）两条分支：{url}（签名 OSS 地址）与
//   OSS 失败降级 {url:'', base64}——都落成「可预览（长按识别/保存）」的图，远程 url 无本地路径时
//   保存走 downloadFile（需域名在后台白名单，取不到就引导长按保存，不假装成功）。
//
// 终审收尾（M1/M2）：
//   游客闸门：无 token / 未登录时一个请求都不发（GET /campaigns/:id 必 401），屏上渲染**游客态**
//   （登录引导 + 「登录后查看」按钮），不是错误态 —— 扫码 / 分享卡落地的新用户不能死在「未授权 + 重试」。
//   闸门走触点级（照 campaign-list 的游客 / 登录引导写法）：进页安静渲染游客态，用户点按钮才 ensureLogin，
//   通过后照常 refresh。
//   退出活动：仅非发起人成员（canLeave）有入口；wx.showModal 二次确认（取消＝零请求）→ POST /:id/leave
//   → refresh(true) 落「你已退出该活动」+「重新加入」（joined→left 可再入，§1.3/§11.2）。
const api = require('../../services/api');
const config = require('../../config/index');
const { ensureLogin } = require('../../utils/login-gate');
const { markHomeDirty } = require('../../utils/home-refresh');
const { statusLabel, visibilityLabel, statusTagClass, fmtRange, joinCta, fmtPanel, truncateName } = require('../../utils/campaign.js');

/** 成员昵称展示上限（字）；超出截断补「...」——排行行里昵称后面还跟「移出」按钮与距离，不能任其撑满 */
const NAME_MAX = 5;

/** 运动类型 key → 中文名（与创建页 / 服务端白名单同一集合，取 config 这一份） */
const TYPE_LABEL = {};
(config.ACTIVITY_TYPES || []).forEach((t) => { TYPE_LABEL[t.type] = t.label; });

/** 成员明细分页大小（服务端默认同为 20；显式传，翻页口径才有据可依） */
const MEMBER_PAGE_SIZE = 20;

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
    statusTag: statusTagClass(d.status),
    visibilityText: visibilityLabel(d.visibility),
    limitText: d.memberLimit == null ? '不限人数' : `上限 ${d.memberLimit} 人`,
    typesText: (d.allowedTypes || []).length
      ? d.allowedTypes.map((t) => TYPE_LABEL[t] || t).join(' / ')
      : '不限运动类型',
  };
}

/** epoch（数字）/ ISO 字符串 → 东八区 MM/DD HH:mm（待审批申请时间 / 轨迹开始时间共用；分隔符同全站「/」）。
 *  appliedAt 在服务端是 Date，过 JSON 后到端上是 ISO 字符串；startTime 是数字 —— 两种都要吃。 */
function fmtMMDDHHmm(v) {
  if (v == null || v === '') return '';
  const t = typeof v === 'number' ? v : new Date(v).getTime();
  if (!Number.isFinite(t)) return '';
  const d = new Date(t + 8 * 3600000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** 全局登录用户 id（发起人身份的比较基准；app.js: globalData.userInfo 是用户对象，含 .id） */
function myUserId() {
  const u = getApp().globalData.userInfo;
  return u && u.id ? String(u.id) : '';
}

/**
 * 发起人身份：detail.creatorId === 我。userInfo 未就绪（冷启动恢复会话在途）时 refresh 会先等它落地；
 * 判否的方向是安全侧：非发起人**绝不**请求 /pending 与 /members/:uid（服务端 403 / 他人数据不外泄）。
 */
function isCreatorOf(detail) {
  const me = myUserId();
  return !!(me && detail && detail.creatorId && String(detail.creatorId) === me);
}

/** 排行榜行 → 成员列表行（名次 / 头像 / 昵称 / 距离 / 次数 / 时长）；头像三级兜底同运动榜。
 *  canKick：仅发起人视角、且不是自己 —— 决定昵称后的「移出」是否渲染（非发起人恒 false）。 */
function toMemberRow(r, canKick) {
  const p = fmtPanel({ count: r.count, distance: r.distance, duration: r.duration });
  return {
    userId: r.userId,
    rank: r.rank,
    name: truncateName(r.name || '微信用户', NAME_MAX),
    medalIcon: r.rank <= 3 ? `/assets/icons/rank-medal-${r.rank}.png` : '',
    avatarSrc: r.avatarUrl || (r.avatarPreset ? `/assets/avatars/${r.avatarPreset}.png` : ''),
    avatarText: (r.name || '迹')[0],
    distanceText: p.distanceText,
    countText: p.countText,
    durationText: p.durationText,
    canKick: !!canKick,
  };
}

/** 待审批行（GET /:id/pending 的 row）：昵称 / 头像（三级兜底同成员行）/ 申请时间 */
function toPendingRow(r) {
  return {
    userId: r.userId,
    name: r.name || '微信用户',
    avatarSrc: r.avatarUrl || (r.avatarPreset ? `/assets/avatars/${r.avatarPreset}.png` : ''),
    avatarText: (r.name || '迹')[0],
    appliedAtText: fmtMMDDHHmm(r.appliedAt),
  };
}

/** 成员明细的一行（GET /:id/members/:uid 的 item）：类型中文 / 东八区开始时间 / 距离 / 时长 /（有爬升才带） */
function toDetailItem(t) {
  const p = fmtPanel({ distance: t.distance, duration: t.duration });
  return {
    id: t.id,
    typeText: TYPE_LABEL[t.type] || t.type,
    timeText: fmtMMDDHHmm(t.startTime),
    distanceText: p.distanceText,
    durationText: p.durationText,
    elevationText: t.elevationGain > 0 ? ` · 爬升 ${Math.round(t.elevationGain)}m` : '',
  };
}

/**
 * 成员 / 发起人专属视图的一键清空（错误态与游客态共用）：非成员屏上不得残留上一场的成员数据
 * （蓝色「我的贡献」条带着旧数字、开着的成员抽屉、审核 / 小程序码弹窗）。
 */
function viewerCleanPatch() {
  return {
    isMember: false,
    canLeave: false,
    canEdit: false,
    totals: null,
    members: [],
    memberTotal: 0, // 成员总数（joined 人数），驱动「加载更多」；老服务端不下发时按已显示数兜底
    memberLoadingMore: false,
    panel: null,
    sheetVisible: false, // 抽屉必须同时关掉
    sheetMember: null,
    sheetDetail: null,
    isCreator: false,
    pendingRows: [],
    pendingCount: 0,
    reviewVisible: false,
    codeVisible: false,
  };
}

Page({
  data: {
    loading: true,
    loggedIn: false, // 登录态（游客态据此渲染；进页时 refresh 会先对齐真实会话）
    notFound: false, // 活动不存在（id 解不出 / 服务端 404）
    error: '', // 首屏加载失败原因（屏上错误态 + 重试）
    head: null, // 顶部信息
    isMember: false, // myState === 'joined'
    canLeave: false, // 非发起人成员才有的「退出活动」入口（isMember && !isCreator）
    canEdit: false, // 发起人才有的「编辑活动」入口（已解散后收回）
    cta: null, // joinCta 结果（成员为 null）
    ctaHint: '', // 按钮下方的显式提示（可点 / 不可点）
    stateNote: '', // 身份说明行
    totals: null, // 全队汇总（仅成员）
    members: [], // 成员列表＝排行榜行（仅成员，随「加载更多」追加）
    memberTotal: 0, // joined 总数，驱动「加载更多」；老服务端不下发 total 时按已显示数兜底
    memberLoadingMore: false,
    panel: null, // 底部悬浮面板：我的 myPanel
    // 成员信息半屏：明细（sheetDetail）对活动内成员一律可看，由 loadMemberDetail 拉
    sheetVisible: false,
    sheetMember: null,
    sheetDetail: null,
    // 发起人专属（Task 11）：待审批徽标 / 审核抽屉 / 解散
    isCreator: false,
    pendingCount: 0,
    pendingRows: [],
    reviewVisible: false,
    // 小程序码（仅 joined 能生成）：展示弹窗的图源（远程 url 或本地临时文件）
    codeVisible: false,
    codeSrc: '',
    codeLocalPath: '',
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

  /** 拉详情（+ 成员时再拉排行榜与待审批）。silent：已有内容时刷新不整屏 loading，防闪屏 */
  async refresh(silent = false) {
    const id = this._id;
    if (!id) return;
    // 冷启动直达本页（分享卡 / 小程序码）：本地会话恢复可能还在途 —— 等它落地再判发起人身份，
    // 否则 userInfo 未就绪会把发起人误判成普通成员，发起人区整段消失；等不到（失败）就当非发起人（安全侧）。
    const app = getApp();
    if (!app.globalData.userInfo && app.globalData.loginPromise) {
      await app.globalData.loginPromise.catch(() => {});
    }
    // 老用户（本地有 token）但会话恢复没落地：补一次静默登录（与 campaign-list.refresh 同口径）。
    // 全新用户（无 token）**不**自动登录 —— 交给游客态里的显式按钮走 ensureLogin（触点级闸门）。
    if (!app.globalData.loggedIn && app.hasSession()) {
      try {
        await app.login();
      } catch (e) {
        console.warn('[campaign-detail] 静默登录失败', e);
      }
    }
    // 游客闸门（M1）：未登录一个请求都不发（GET /campaigns/:id 必 401），屏上渲染**游客态**（不是错误态）——
    // 扫码 / 分享卡落地的新用户必须有登录出路，不能死在「未授权 + 重试」的死屏里。
    if (!app.globalData.loggedIn) {
      this.setData(Object.assign({
        loggedIn: false,
        loading: false,
        notFound: false,
        error: '',
      }, viewerCleanPatch()));
      return;
    }
    if (!this.data.loggedIn) this.setData({ loggedIn: true });
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
      const notFound = !!(e && e.statusCode === 404);
      const empty = !this.data.head;
      const error = empty && e && e.statusCode !== 404 ? (e.message || '加载失败') : '';
      const patch = { loading: false, notFound, error };
      // 进「错误态 / 活动不存在」态时，成员专属视图必须清干净：否则上一场的成员态
      // （蓝色「我的贡献」条带着旧数字、甚至一个开着的成员抽屉）会压在错误屏上——
      // 违反本页成功路径的数据卫生约定（applyDetail 对非成员硬清零成员字段）。
      // 发起人专属视图（审批抽屉 / 小程序码弹窗）同一理由一并收掉。
      if (notFound || error) {
        Object.assign(patch, viewerCleanPatch());
      }
      this.setData(patch);
      return;
    }
    if (seq !== this._seq) return;

    // 排行榜只对成员拉：非成员服务端 403；失败不拖垮整页（成员列表退化为空，底部面板仍用 myPanel）
    // 刷新一律回第 1 页：屏上的列表会被 applyDetail 整个换掉，继续留在第 N 页只会显示不全
    let board = null;
    if (detail.myState === 'joined') {
      board = await api.get(`/campaigns/${id}/leaderboard?page=1&pageSize=${MEMBER_PAGE_SIZE}`).catch((e) => {
        console.warn('[campaign-detail] 排行榜加载失败', e);
        return null;
      });
      if (seq !== this._seq) return;
    }

    // 待审批只对发起人拉（非发起人服务端 403，且属「他人数据不外泄」的需求约束）。
    // 失败返回 null＝保住已有列表/徽标（静默，不闪没），由 applyDetail 分辨「未拉取」与「拉到空」。
    let pending = null;
    if (isCreatorOf(detail) && detail.myState === 'joined') {
      pending = await api.get(`/campaigns/${id}/pending`).catch((e) => {
        console.warn('[campaign-detail] 待审批列表加载失败', e);
        return null;
      });
      if (seq !== this._seq) return;
    }

    this.applyDetail(detail, board, pending);
    this._loaded = true;
  },

  /** 详情（+ 排行榜 + 待审批）→ 视图：一处分流，避免 WXML 里散落身份判断 */
  applyDetail(detail, board, pending = null) {
    const isMember = detail.myState === 'joined';
    const isCreator = isCreatorOf(detail) && isMember;
    const me = myUserId();
    const rows = board && Array.isArray(board.rows) ? board.rows : [];
    // 「加载更多」的判据是 total，不是本页行数（本页满 20 不代表后面没人）。
    // 老服务端不下发 total → 按「已显示的就是全部」兜底：宁可少一个入口，也不给一个点了没反应的按钮。
    const memberTotal = board ? (typeof board.total === 'number' ? board.total : rows.length) : 0;
    const cta = joinCta({
      myState: detail.myState,
      canJoin: detail.canJoin,
      status: detail.status,
      visibility: detail.visibility,
    });
    // 待审批：pending === null（未拉取/拉取失败）时保住已有列表，别把徽标闪没；非发起人恒清空
    const pendingRows = isCreator
      ? (pending === null ? this.data.pendingRows : (pending.rows || []).map(toPendingRow))
      : [];
    this._memberPage = 1; // 成员分页页码只在 JS 用，不进 data
    this.setData({
      loading: false,
      notFound: false,
      error: '',
      head: toHead(detail),
      isMember,
      canLeave: isMember && !isCreator, // 退出活动：我不是发起人（发起人出路是解散）
      isCreator,
      // 编辑：只认发起人，且**未开始 / 进行中**都给入口——已结束 / 已解散才收回（服务端 PUT 同口径）。
      // 未开始正是最该调时间与标题的阶段，挡在它身上没有理由。
      // 状态由服务端下发，端上不拿 startAt / endAt 跟 now 自己比，避免两处判据分叉。
      canEdit: isCreator && (detail.status === 'active' || detail.status === 'upcoming'),
      cta,
      ctaHint: cta ? (cta.disabled ? '当前不可加入' : `点击「${cta.text}」`) : '',
      stateNote: STATE_NOTE[detail.myState] || '',
      totals: isMember && detail.totals ? fmtPanel(detail.totals) : null,
      members: isMember ? rows.map((r) => toMemberRow(r, isCreator && String(r.userId) !== me)) : [],
      memberTotal: isMember ? memberTotal : 0,
      memberLoadingMore: false,
      panel: isMember && detail.myPanel ? fmtPanel(detail.myPanel) : null,
      pendingRows,
      pendingCount: pendingRows.length,
      reviewVisible: this.data.reviewVisible && pendingRows.length > 0,
      // 身份可能已变（加入成功 / 被移出）：旧成员的半屏不能停在过期数据上
      sheetVisible: false,
      sheetMember: null,
      sheetDetail: null,
    });
  },

  /** 首屏失败重试 */
  retry() {
    this.setData({ loading: true, error: '' });
    return this.refresh();
  },

  /**
   * 游客态「登录后查看」：触点级登录闸门（照 campaign-list 的游客引导；用户点了才弹，不在 onLoad 自动弹）。
   * 取消 / 登录失败 → 留在游客态（按钮可再点），一个请求都不发；通过 → 照常拉详情。
   */
  async guestLogin() {
    const ok = await ensureLogin();
    if (!ok) return;
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
      markHomeDirty();
      wx.showToast({ title: cta.text + '成功', icon: 'success' });
      await this.refresh(true);
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '操作失败', icon: 'none' });
    } finally {
      this._joining = false;
    }
  },

  /**
   * 成员排行「加载更多」：把下一页**追加**到同一个列表。
   * 名次由服务端按全员距离算好后一并下发（分页只切响应），端上不再排序。
   */
  async loadMoreMembers() {
    const { members, memberTotal, memberLoadingMore, isCreator } = this.data;
    const memberPage = this._memberPage || 1;
    if (memberLoadingMore || members.length >= memberTotal) return;
    // 与 refresh 共用同一个序号：期间发生过整页刷新，这一页就是接在旧列表后面的，必须丢
    const seq = this._seq;
    this.setData({ memberLoadingMore: true });
    try {
      const board = await api.get(
        `/campaigns/${this._id}/leaderboard?page=${memberPage + 1}&pageSize=${MEMBER_PAGE_SIZE}`,
      );
      if (seq !== this._seq) return;
      const rows = board && Array.isArray(board.rows) ? board.rows : [];
      const me = myUserId();
      this._memberPage = memberPage + 1;
      this.setData({
        members: members.concat(rows.map((r) => toMemberRow(r, isCreator && String(r.userId) !== me))),
        memberTotal: typeof board.total === 'number' ? board.total : members.length + rows.length,
        memberLoadingMore: false,
      });
    } catch (e) {
      if (seq !== this._seq) return;
      // 失败：列表留在原地、页码不前进（重试才会重新要同一页），按钮还在，用户看得见「还差多少」
      this.setData({ memberLoadingMore: false });
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
    }
  },

  /** 点成员行 → 成员信息半屏，并拉该成员的分页明细（明细对**活动内成员**开放，队友与本人同样可看） */
  openMember(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const member = this.data.members[idx];
    if (!member) return;
    this.setData({ sheetVisible: true, sheetMember: member, sheetDetail: null });
    this.loadMemberDetail(member.userId, 1);
  },

  closeMemberSheet() {
    this.setData({ sheetVisible: false, sheetDetail: null });
  },

  /**
   * 拉某成员的分页明细：page=1 首屏（点成员行），翻页由半屏「加载更多」事件触发。
   * `_sheetSeq` 防「换人 / 关抽屉后旧响应落地」——明细是他人数据，串行错人比空屏更糟。
   */
  async loadMemberDetail(uid, page) {
    const seq = (this._sheetSeq = (this._sheetSeq || 0) + 1);
    if (page === 1) {
      this.setData({ sheetDetail: { loading: true, error: false, stats: null, items: [], total: 0, page: 0, hasMore: false, loadingMore: false } });
    } else {
      this.setData({ 'sheetDetail.loadingMore': true });
    }
    try {
      const data = await api.get(`/campaigns/${this._id}/members/${uid}?page=${page}&pageSize=${MEMBER_PAGE_SIZE}`);
      if (seq !== this._sheetSeq || !this.data.sheetVisible) return; // 已换人 / 已关抽屉：丢弃
      const prev = page === 1 ? [] : ((this.data.sheetDetail && this.data.sheetDetail.items) || []);
      const items = prev.concat((data.items || []).map(toDetailItem));
      const total = data.total || 0;
      this.setData({
        sheetDetail: {
          loading: false,
          error: false,
          stats: fmtPanel(data.stats || {}), // 概况以该接口的 stats 为准（与排行榜同源）
          items,
          total,
          page: data.page || page,
          hasMore: items.length < total,
          loadingMore: false,
        },
      });
    } catch (err) {
      if (seq !== this._sheetSeq) return;
      console.warn('[campaign-detail] 成员明细加载失败', err);
      // 静默：半屏内出错误态；已加载的列表留在原地（加载更多按钮也留着，可重试），不弹 toast 打断
      const prev = this.data.sheetDetail || {};
      this.setData({ sheetDetail: Object.assign({}, prev, { loading: false, loadingMore: false, error: true }) });
    }
  },

  /** 半屏「加载更多」（组件只抛事件，数据由页面拉） */
  onSheetLoadMore() {
    const d = this.data.sheetDetail;
    const member = this.data.sheetMember;
    if (!member || !d || d.loadingMore || !d.hasMore) return;
    this.loadMemberDetail(member.userId, (d.page || 1) + 1);
  },

  /** 审核抽屉开合（徽标点击；发起人且有待审批才有内容） */
  openReview() {
    if (!this.data.isCreator || this.data.pendingRows.length === 0) return;
    this.setData({ reviewVisible: true });
  },

  closeReview() {
    this.setData({ reviewVisible: false });
  },

  /** 同意 / 拒绝：body 字段名就是 userId（服务端 zod 校验） */
  onApprove(e) {
    this.reviewAction(e, 'approve', '已同意');
  },

  onReject(e) {
    this.reviewAction(e, 'reject', '已拒绝');
  },

  async reviewAction(e, action, okText) {
    const idx = Number(e.currentTarget.dataset.idx);
    const row = this.data.pendingRows[idx];
    if (!row || this._reviewing) return;
    this._reviewing = true;
    try {
      await api.post(`/campaigns/${this._id}/${action}`, { userId: row.userId });
      markHomeDirty(); // 成员面的头像/人数会变
      wx.showToast({ title: okText, icon: 'success' });
      // 本地先移除该行（抽屉即时收窄），再静默刷新取服务端最新态（同意会进成员榜）
      const pendingRows = this.data.pendingRows.filter((r) => r.userId !== row.userId);
      this.setData({ pendingRows, pendingCount: pendingRows.length, reviewVisible: pendingRows.length > 0 });
      await this.refresh(true);
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' });
    } finally {
      this._reviewing = false;
    }
  },

  /** 移出（仅发起人、且非自己；按钮只在 canKick 的行上渲染）。二次确认前零请求 */
  onKickTap(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const member = this.data.members[idx];
    if (!member || !member.canKick || this._kicking) return;
    wx.showModal({
      title: '移出成员',
      content: '确定把 TA 移出活动？',
      success: (res) => {
        if (!res.confirm) return; // 取消：不发请求、不改状态
        this.doKick(member);
      },
    });
  },

  async doKick(member) {
    this._kicking = true;
    try {
      await api.post(`/campaigns/${this._id}/kick`, { userId: member.userId });
      markHomeDirty();
      wx.showToast({ title: '已移出', icon: 'success' });
      // 被移出的人若正开着明细半屏：数据已失效，先关掉（刷新失败也不残留）
      if (this.data.sheetMember && this.data.sheetMember.userId === member.userId) {
        this.setData({ sheetVisible: false, sheetMember: null, sheetDetail: null });
      }
      await this.refresh(true);
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '操作失败', icon: 'none' });
    } finally {
      this._kicking = false;
    }
  },

  /**
   * 退出活动（仅非发起人成员，canLeave 才渲染入口）。二次确认后才 POST —— 取消＝零请求
   * （同踢人 / 解散口径）。需求 §1.3/§11.2：成员可随时离开，joined→left 可再入。
   */
  onLeave() {
    if (!this.data.canLeave || this._leaving) return;
    wx.showModal({
      title: '退出活动',
      content: '确定退出该活动？退出后可重新加入。',
      success: (res) => {
        if (!res.confirm) return; // 取消：不发请求、不改状态
        this.doLeave();
      },
    });
  },

  async doLeave() {
    this._leaving = true;
    try {
      await api.post(`/campaigns/${this._id}/leave`);
      markHomeDirty();
      wx.showToast({ title: '已退出活动', icon: 'success' });
      // 服务端 myState→left：刷新即转「你已退出该活动」+「重新加入」（渲染路径在 applyDetail，端上不自己拼状态）
      await this.refresh(true);
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '操作失败', icon: 'none' });
    } finally {
      this._leaving = false;
    }
  },

  /** 解散（仅发起人）。二次确认后才 DELETE —— 取消＝零请求 */
  /** 编辑活动（仅发起人，且未解散）：跳创建页的编辑态（同一个表单，带 ?id= 即预填）。
   *  这里只是「不给入口」，真正的权限闸门在服务端 PUT /campaigns/:id——直接拼 url 进来也改不动。 */
  goEdit() {
    if (!this.data.canEdit) return;
    wx.navigateTo({ url: `/pages/campaign-create/campaign-create?id=${this._id}` });
  },

  onDissolve() {
    if (!this.data.isCreator || this._dissolving) return;
    wx.showModal({
      title: '解散活动',
      content: '解散后活动页只读，确定？',
      success: (res) => {
        if (!res.confirm) return; // 取消：不发请求
        this.doDissolve();
      },
    });
  },

  async doDissolve() {
    this._dissolving = true;
    try {
      await api.del(`/campaigns/${this._id}`);
      markHomeDirty();
      wx.showToast({ title: '活动已解散', icon: 'success' });
      await this.refresh(true); // 「已解散」由服务端 status 派生，刷新即得，端上不重算
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '操作失败', icon: 'none' });
    } finally {
      this._dissolving = false;
    }
  },

  /** 邀请（仅 joined；服务端也拦非成员 403）：生成小程序码 → 展示弹窗，可长按识别 / 保存 */
  onInvite() {
    if (!this.data.isMember || this._codeLoading) return;
    this.doInvite();
  },

  async doInvite() {
    this._codeLoading = true;
    wx.showLoading({ title: '生成中…', mask: true });
    try {
      const body = { campaignId: this._id };
      try { body.envVersion = wx.getAccountInfoSync().miniProgram.envVersion; } catch (e) { /* 低版本基础库不支持，不传 */ }
      const data = (await api.post('/campaigns/mini-code', body)) || {};
      let src = data.url || '';
      let localPath = '';
      if (!src && data.base64) {
        // OSS 上传失败的降级分支：base64 → 落临时文件（previewImage / saveImageToPhotosAlbum 只吃路径）
        localPath = await this.writeCodeFile(data.base64);
        src = localPath;
      }
      if (!src) throw new Error('生成失败，请重试');
      this.setData({ codeVisible: true, codeSrc: src, codeLocalPath: localPath });
    } catch (e) {
      console.error('[campaign-detail] 小程序码生成失败', e);
      wx.showToast({ title: (e && e.message) || '生成失败，请重试', icon: 'none' });
    } finally {
      this._codeLoading = false;
      wx.hideLoading();
    }
  },

  /** base64 数据（可带 data: 前缀）→ USER_DATA_PATH 下的临时文件，返回文件路径 */
  writeCodeFile(dataUri) {
    return new Promise((resolve, reject) => {
      const filePath = `${wx.env.USER_DATA_PATH}/campaign-mini-code-${this._id}.png`;
      wx.getFileSystemManager().writeFile({
        filePath,
        data: String(dataUri).replace(/^data:image\/\w+;base64,/, ''),
        encoding: 'base64',
        success: () => resolve(filePath),
        fail: reject,
      });
    });
  },

  closeCode() {
    this.setData({ codeVisible: false });
  },

  /** 放大预览：预览页里长按图片即可识别小程序码 / 保存（小程序码的标准识别路径） */
  previewCode() {
    if (!this.data.codeSrc) return;
    wx.previewImage({ urls: [this.data.codeSrc], current: this.data.codeSrc });
  },

  /**
   * 保存到相册：本地文件直接存；远程 url 先 downloadFile 换本地路径
   * （该域名需在后台 downloadFile 合法域名里，被拦时明确引导长按保存，不假装成功）。
   */
  saveCode() {
    if (this._savingCode) return;
    const local = this.data.codeLocalPath;
    if (local) {
      this.saveCodeToAlbum(local);
      return;
    }
    const src = this.data.codeSrc;
    if (!src) return;
    this._savingCode = true;
    wx.downloadFile({
      url: src,
      success: (res) => {
        if (res.statusCode === 200 && res.tempFilePath) this.saveCodeToAlbum(res.tempFilePath);
        else wx.showToast({ title: '保存失败，可长按图片识别或保存', icon: 'none' });
      },
      fail: () => {
        console.warn('[campaign-detail] 小程序码下载失败（域名可能不在 downloadFile 合法域名里）');
        wx.showToast({ title: '保存失败，可长按图片识别或保存', icon: 'none' });
      },
      complete: () => {
        this._savingCode = false;
      },
    });
  },

  /** 存相册（首次需授权，拒绝后引导去设置；照 leaderboard.js saveShareImage 的失败分支） */
  saveCodeToAlbum(filePath) {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        if (msg.includes('auth') || msg.includes('deny') || msg.includes('authorize')) {
          wx.showModal({
            title: '需要相册权限',
            content: '保存图片需要相册权限，是否前往设置开启？',
            confirmText: '去设置',
            success: (r) => {
              if (r.confirm) wx.openSetting();
            },
          });
        } else {
          wx.showToast({ title: '保存失败，可长按图片识别或保存', icon: 'none' });
        }
      },
    });
  },

  /** 分享给朋友（照 track-detail.js:567-584 的写法；标题＝活动标题，path 带 id 回本页） */
  onShareAppMessage() {
    const head = this.data.head || {};
    return {
      title: head.title || '一起运动活动',
      path: `/pages/campaign-detail/campaign-detail?id=${this._id}`,
    };
  },

  /** 分享到朋友圈（进页面后走 id 解析，与分享卡的 id 通道一致） */
  onShareTimeline() {
    const head = this.data.head || {};
    return {
      title: head.title || '一起运动活动',
      query: `id=${this._id}`,
    };
  },

  /** 半屏遮罩的 touch 吞并 / 内容区防穿透点击（WXML 里 catchtouchmove / catchtap 用） */
  noop() {},

  onPullDownRefresh() {
    this.refresh(true).finally(() => wx.stopPullDownRefresh());
  },
});

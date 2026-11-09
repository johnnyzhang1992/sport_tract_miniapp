// 创建活动页 / 编辑活动页（同一个页面两种模式）。
//
// 模式：不带参数＝创建（活动列表页「＋发起」进）；带 `?id=`＝编辑（活动详情页发起人「编辑」进）。
// 编辑模式复用同一张表单，只多三件事：进页 GET /campaigns/:id 预填、开始日期只读、提交走 PUT。
// 不复用表单而另开一页必然分叉（校验文案、chips 点亮、人数上限口径都要抄两份）。
//
// 校验口径镜像服务端 CreateCampaignSchema / UpdateCampaignSchema
// （sport_track_api/src/utils/validators.ts）：
//   title 1–30、visibility public|private、allowedTypes ⊆ 8 项白名单（空=不限制）、
//   memberLimit 正整数 ≤500 或 null、endDate 严格 YYYY-MM-DD 且 endDate ≥ startDate。
// 上限在端上先拦（maxlength + 即时提示 + onSubmit 兜底），别让用户提交完才吃 400。
// 日期用 <picker mode="date"> 拿 YYYY-MM-DD 原样上送（服务端按东八区转 epoch，端上不做时区换算）。
// 编辑态**不上送 startDate**：UpdateCampaignSchema 是 .strict()，多传一个字段就整请求 400。
const config = require('../../config/index');
const { slashDate } = require('../../utils/campaign.js');
const api = require('../../services/api');
const { ensureLogin } = require('../../utils/login-gate');
const { markHomeDirty } = require('../../utils/home-refresh');
const { setPageTitle } = require('../../utils/nav-title');

const MAX_TITLE = 30;
const MAX_MEMBERS = 500;
const DEFAULT_MEMBERS = 100; // 人数上限的默认值（页面预填；清空＝不限制）
/** 活动最长跨度（含首尾的日历日），与服务端 assertCampaignSpan 同一条线 */
const MAX_SPAN_DAYS = 365;

/** PK 类型：活动创建后不可改（服务端 UpdateCampaignSchema 不收 kind） */
const KIND_OPTIONS = [
  { key: 'activity', label: '运动PK' },
  { key: 'steps', label: '步数PK' },
];

/** 本地当天 YYYY-MM-DD，仅作 picker 默认值（纯字符串，不做任何时区换算） */
function localToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** YYYY-MM-DD ± n 个日历日：走 UTC 算，避开本机时区（中国无夏令时，但跨日界仍会错一天） */
function plusDays(dateStr, n) {
  const t = Date.parse(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(t)) return '';
  return new Date(t + n * 86400000).toISOString().slice(0, 10);
}

/** 含首尾的天数（与服务端同口径：endAt 是「结束日 24:00」，差值即天数） */
function spanDays(startDate, endDate) {
  const a = Date.parse(`${startDate}T00:00:00Z`);
  const b = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

/**
 * 标题自动生成（产品口径：标题不再手填）：`类型{含首尾天数}天PK活动`。
 * - 步数PK 不分类型 → 「微信步数31天PK活动」；
 * - 运动类型空选（不限）→ 「综合运动31天PK活动」；
 * - 单选 → 「散步31天PK活动」；多选取前 3 个类型名，超出补「等」→ 「跑步、骑行、徒步等31天PK活动」。
 * 服务端上限 30 字：超长兜底截断（正常组合到不了 30）。
 */
function generatedTitleOf(kind, selectedLabels, startDate, endDate) {
  const days = spanDays(startDate, endDate);
  let head;
  if (kind === 'steps') head = '微信步数';
  else if (!selectedLabels.length) head = '综合运动';
  else head = selectedLabels.slice(0, 3).join('、') + (selectedLabels.length > 3 ? '等' : '');
  return `${head}${days}天PK活动`.slice(0, MAX_TITLE);
}

Page({
  data: {
    title: '',
    autoJoin: true, // 自动加入开关（开=公开自动加入，关=需发起人同意）；visibility 由它派生
    visibility: 'public',
    // PK 类型：activity=运动PK（按轨迹） / steps=步数PK（只按活动周期内微信步数）
    kind: 'activity',
    kindOptions: KIND_OPTIONS,
    // 普通运动PK 是否开启微信步数辅助（成员半屏按天对比；不影响排名）
    stepAuxEnabled: false,
    // chips 视图态：数据源 config.ACTIVITY_TYPES（与后端白名单同一集合），active 跟 allowedTypes 同步
    types: config.ACTIVITY_TYPES.map((t) => ({ type: t.type, label: t.label, iconImg: t.iconImg, active: false })),
    allowedTypes: [], // 选中的类型；空数组 = 不限制
    memberLimit: String(DEFAULT_MEMBERS), // 字符串；默认 100，清空 = 不限制（提交时转 null）
    startDate: '', // 规范值（picker 的 value 与上送体都用它，必须 YYYY-MM-DD）
    endDate: '',
    startDateText: '', // 展示值（YYYY/MM/DD），只给 wxml 看
    endDateText: '',
    dateError: '', // 起止倒置的即时提示（onSubmit 仍会兜底再判一次）
    maxEndDate: '', // 结束日期可选上界＝开始日期 + 364 天（含首尾正好一年），跟着 startDate 挪
    submitting: false,
    canSubmit: true, // 标题自动生成后表单没有「没填」的必填项，按钮恒可点（校验都在 onSubmit 的 toast 里）
    isEdit: false, // 带 ?id= 进页即编辑模式
    editId: '',
    maxTitle: MAX_TITLE,
    maxMembers: MAX_MEMBERS,
    defaultMembers: DEFAULT_MEMBERS,
  },

  onLoad(options) {
    // 进页登录闸门（2026-10-26 需求）：创建/编辑活动必须登录。单点拦在目标页，
    // 三个入口（首页引导卡 / 活动列表 / 活动详情）一起覆盖，入口侧不再各自判。
    this._options = options || {};
    const app = getApp();
    if (app.hasSession && app.hasSession() && !app.globalData.loggedIn) {
      // 本地有 token 的老用户先静默恢复；恢复不了（token 失效）再走弹窗
      app
        .login()
        .catch(() => {})
        .then(() => this.gateLogin());
      return;
    }
    this.gateLogin();
  },

  /** 登录闸门：已登录 → 初始化表单；游客 → 弹 ensureLogin，取消即提示并退页 */
  async gateLogin() {
    if (getApp().globalData.loggedIn) {
      this.initForm();
      return;
    }
    const ok = await ensureLogin();
    if (ok) {
      this.initForm();
      return;
    }
    // toast 与退页同时发：toast 会盖在转场上继续显示，不需要人为延迟（延迟反而在快速返回时拖泥带水）
    wx.showToast({ title: '登录后才能创建活动', icon: 'none' });
    wx.navigateBack({ delta: 1 });
  },

  /** 表单初始化（原 onLoad 主体；登录确认后才执行） */
  initForm() {
    const options = this._options || {};
    const id = (options && options.id) || '';
    if (id) {
      this.setData({ isEdit: true, editId: id });
      setPageTitle(this, '编辑活动');
      this.loadForEdit(id);
      return;
    }
    const today = localToday();
    const endDate = plusDays(today, 6); // 结束日期默认今天 + 6 天（含首尾正好 7 天 → 「7天PK活动」）
    this.setData({
      startDate: today,
      endDate,
      startDateText: slashDate(today),
      endDateText: slashDate(endDate),
      maxEndDate: plusDays(today, MAX_SPAN_DAYS - 1),
    });
    this.syncTitle();
  },

  /** 编辑模式预填：日期直接取服务端下发的 YYYY-MM-DD 串（端上不做时区换算），chips 跟着 allowedTypes 点亮 */
  async loadForEdit(id) {
    try {
      const d = await api.get(`/campaigns/${id}`);
      const kind = d.kind === 'steps' ? 'steps' : 'activity';
      const allowed = d.allowedTypes || [];
      this.setData({
        visibility: d.visibility,
        autoJoin: d.visibility === 'public',
        kind,
        stepAuxEnabled: kind === 'activity' && d.stepAuxEnabled === true,
        allowedTypes: allowed,
        types: this.data.types.map((t) => Object.assign({}, t, { active: allowed.indexOf(t.type) >= 0 })),
        memberLimit: d.memberLimit == null ? '' : String(d.memberLimit),
        startDate: d.startDate,
        endDate: d.endDate,
        startDateText: slashDate(d.startDate),
        endDateText: slashDate(d.endDate),
        maxEndDate: plusDays(d.startDate, MAX_SPAN_DAYS - 1),
        canSubmit: true,
      });
      this.syncTitle(); // 标题按当前类型与活动天数重新生成（不再回填历史手填标题）
    } catch (e) {
      // 非发起人 / 已解散 / 断网都到这里：退回来源页（详情页），别留一张点了也没用的空表单。
      // canSubmit 置 false：返回动画期间按钮先锁住，即使被强行 onSubmit 也不会发出 PUT。
      this.setData({ canSubmit: false });
      wx.showToast({ title: (e && e.message) || '活动信息加载失败', icon: 'none' });
      wx.navigateBack();
    }
  },

  /** 自动加入开关：开＝公开（被邀请人自动加入），关＝隐私（需发起人同意） */
  onAutoJoin(e) {
    const autoJoin = e.detail.value === true;
    this.setData({ autoJoin, visibility: autoJoin ? 'public' : 'private' });
  },

  /** 标题自动生成：类型/天数变化后重算（创建与编辑同一口径） */
  syncTitle() {
    const { kind, allowedTypes, startDate, endDate, types } = this.data;
    const labels = types
      .filter((t) => allowedTypes.indexOf(t.type) >= 0)
      .map((t) => t.label);
    this.setData({ title: generatedTitleOf(kind, labels, startDate, endDate) });
  },

  /** PK 类型：编辑态不可改（服务端不收 kind）；切到步数PK时清空类型与辅助开关 */
  onKind(e) {
    const kind = e.currentTarget.dataset.value;
    if (!kind || kind === this.data.kind) return;
    if (this.data.isEdit) return;
    if (kind === 'steps') {
      this.setData({
        kind,
        stepAuxEnabled: false,
        allowedTypes: [],
        types: this.data.types.map((t) => Object.assign({}, t, { active: false })),
      });
      this.syncTitle();
      return;
    }
    this.setData({ kind });
    this.syncTitle();
  },

  onStepAuxChange(e) {
    this.setData({ stepAuxEnabled: !!e.detail.value });
  },

  /** 运动类型多选：再点已选中的即取消（空选＝不限制） */
  onTypeToggle(e) {
    const type = e.currentTarget.dataset.type;
    if (!type) return;
    const has = this.data.allowedTypes.includes(type);
    const allowedTypes = has
      ? this.data.allowedTypes.filter((t) => t !== type)
      : this.data.allowedTypes.concat(type);
    this.setData({
      allowedTypes,
      types: this.data.types.map((t) => (t.type === type ? Object.assign({}, t, { active: !has }) : t)),
    });
    this.syncTitle();
  },

  /** 人数上限：只收数字（数字键盘仍可能带出小数点/负号），上限在提交时兜底判 */
  onMemberLimit(e) {
    this.setData({ memberLimit: String(e.detail.value || '').replace(/\D/g, '') });
  },

  onStartDate(e) {
    const startDate = e.detail.value;
    // 上界跟着挪：不然改了开始日期，结束日期选择器还卡在旧上界上
    this.setData({
      startDate,
      startDateText: slashDate(startDate),
      maxEndDate: plusDays(startDate, MAX_SPAN_DAYS - 1),
    });
    this.refreshDateError();
    this.syncTitle();
  },
  onEndDate(e) {
    this.setData({ endDate: e.detail.value, endDateText: slashDate(e.detail.value) });
    this.refreshDateError();
    this.syncTitle();
  },
  /** 即时提示：起止倒置在选完当下就点名，不等提交 */
  refreshDateError() {
    const { startDate, endDate } = this.data;
    const bad = startDate && endDate && endDate < startDate;
    this.setData({
      dateError: bad ? `结束日期不能早于开始日期（${slashDate(endDate)} < ${slashDate(startDate)}）` : '',
    });
  },

  async onSubmit() {
    if (this.data.submitting) return;

    this.syncTitle(); // 提交前按当前类型/天数重算，标题永远与表单一致
    const title = this.data.title;
    const { visibility, allowedTypes, startDate, endDate, kind } = this.data;
    const isSteps = kind === 'steps';
    const memberRaw = String(this.data.memberLimit || '').trim();

    // 前端镜像服务端上限：违反时给「对象 + 实际值 + 上限」的提示，一个请求都不发
    if (title.length < 1 || title.length > MAX_TITLE) {
      return wx.showToast({ title: `标题需 1–${MAX_TITLE} 字，当前 ${title.length} 字`, icon: 'none' });
    }
    if (!startDate || !endDate) {
      return wx.showToast({ title: '请选择开始和结束日期', icon: 'none' });
    }
    if (endDate < startDate) {
      return wx.showToast({
        title: `结束日期不能早于开始日期（${slashDate(endDate)} < ${slashDate(startDate)}）`,
        icon: 'none',
      });
    }
    // 镜像服务端的跨度上限：超了就是一个请求都不发，提示带实际天数（picker 的 end 已挡住大多数，
    // 这里兜编辑态预填和手改）
    if (spanDays(startDate, endDate) > MAX_SPAN_DAYS) {
      return wx.showToast({
        title: `活动最长 ${MAX_SPAN_DAYS} 天：${slashDate(startDate)} ~ ${slashDate(endDate)} 跨 ${spanDays(startDate, endDate)} 天`,
        icon: 'none',
      });
    }
    let memberLimit = null;
    if (memberRaw) {
      memberLimit = Number(memberRaw);
      if (!Number.isInteger(memberLimit) || memberLimit < 1 || memberLimit > MAX_MEMBERS) {
        return wx.showToast({ title: `人数上限需 1–${MAX_MEMBERS} 的整数，当前 ${memberRaw}`, icon: 'none' });
      }
    }

    // 先在 await 之前置位 submitting：
    // 连点两下时第二下会被顶部 `if (this.data.submitting) return` 短路，不会两次过登录闸门、发两次 POST
    // 建出两个活动（Important-2 双提交窗口，根因是原实现在 await 之后才置位）。
    this.setData({ submitting: true });

    // 登录闸门：通过后才允许提交（游客取消 → 一个请求都不发；早退分支必须复位，否则同样锁死）
    const ok = await ensureLogin();
    if (!ok) {
      this.setData({ submitting: false });
      return;
    }

    try {
      if (this.data.isEdit) {
        // 不带 startDate / kind：服务端 .strict()，多传字段＝整请求 400。
        // 步数PK 不收 allowedTypes / stepAuxEnabled（服务端会拒绝），只提交通用字段。
        const editBody = { title, visibility, memberLimit, endDate };
        // description 不上送：服务端编辑是部分更新（不传＝保留原值），描述字段已从产品上去掉
        if (!isSteps) {
          editBody.allowedTypes = allowedTypes;
          editBody.stepAuxEnabled = this.data.stepAuxEnabled === true;
        }
        await api.put(`/campaigns/${this.data.editId}`, editBody);
        this.setData({ submitting: false });
        markHomeDirty();
        wx.showToast({ title: '已保存', icon: 'success' });
        // 编辑是从详情页 navigateTo 进来的：退回详情页，由它的 onShow 静默刷新拿最新值。
        // 不再 navigateTo 一次详情页——那会在栈里多压一层，返回时用户会看到两张详情页。
        wx.navigateBack();
        return;
      }
      const created = await api.post('/campaigns', {
        title,
        visibility,
        kind,
        // 步数PK 不区分运动类型；辅助开关只对普通运动PK 有意义
        allowedTypes: isSteps ? [] : allowedTypes,
        stepAuxEnabled: isSteps ? false : this.data.stepAuxEnabled === true,
        memberLimit,
        startDate,
        endDate,
      });
      // 成功分支必须复位：wx.navigateTo 是「推送」详情页，本页仍留在导航栈里；
      // 若 submitting 仍为 true，用户从详情页返回后按钮会永久 disabled/loading、文案停在「创建中…」，
      // 且 onSubmit 被守卫短路，页面上没有任何重置路径 → 真用户被锁死（Critical-1）。
      this.setData({ submitting: false });
      markHomeDirty();
      wx.showToast({ title: '活动已创建', icon: 'success' });
      const id = created && created.id;
      wx.navigateTo({ url: `/pages/campaign-detail/campaign-detail?id=${id}` });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '创建失败', icon: 'none' });
      this.setData({ submitting: false });
    }
  },
});

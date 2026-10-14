// 创建活动页（活动列表页「＋发起」进）。
//
// 校验口径镜像服务端 POST /campaigns 的 CreateCampaignSchema（sport_track_api/src/utils/validators.ts）：
//   title 1–30、description ≤300、visibility public|private、allowedTypes ⊆ 8 项白名单（空=不限制）、
//   memberLimit 正整数 ≤500 或 null、startDate/endDate 严格 YYYY-MM-DD 且 endDate ≥ startDate。
// 上限在端上先拦（maxlength + 即时提示 + onSubmit 兜底），别让用户提交完才吃 400。
// 日期用 <picker mode="date"> 拿 YYYY-MM-DD 原样上送（服务端按东八区转 epoch，端上不做时区换算）。
const config = require('../../config/index');
const api = require('../../services/api');
const { ensureLogin } = require('../../utils/login-gate');

const MAX_TITLE = 30;
const MAX_DESC = 300;
const MAX_MEMBERS = 500;

// 可见性两选一（key 与后端 enum 一一对应）
const VISIBILITY_OPTIONS = [
  { key: 'public', label: '公开' },
  { key: 'private', label: '隐私' },
];

/** 本地当天 YYYY-MM-DD，仅作 picker 默认值（纯字符串，不做任何时区换算） */
function localToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

Page({
  data: {
    title: '',
    description: '',
    visibility: 'public',
    visibilityOptions: VISIBILITY_OPTIONS,
    // chips 视图态：数据源 config.ACTIVITY_TYPES（与后端白名单同一集合），active 跟 allowedTypes 同步
    types: config.ACTIVITY_TYPES.map((t) => ({ type: t.type, label: t.label, iconImg: t.iconImg, active: false })),
    allowedTypes: [], // 选中的类型；空数组 = 不限制
    memberLimit: '', // 字符串；空 = 不限制（提交时转 null）
    startDate: '',
    endDate: '',
    dateError: '', // 起止倒置的即时提示（onSubmit 仍会兜底再判一次）
    submitting: false,
    maxTitle: MAX_TITLE,
    maxDesc: MAX_DESC,
    maxMembers: MAX_MEMBERS,
  },

  onLoad() {
    const today = localToday();
    this.setData({ startDate: today, endDate: today });
  },

  onTitle(e) {
    this.setData({ title: e.detail.value });
  },
  onDesc(e) {
    this.setData({ description: e.detail.value });
  },
  onVisibility(e) {
    const value = e.currentTarget.dataset.value;
    if (value) this.setData({ visibility: value });
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
  },

  /** 人数上限：只收数字（数字键盘仍可能带出小数点/负号），上限在提交时兜底判 */
  onMemberLimit(e) {
    this.setData({ memberLimit: String(e.detail.value || '').replace(/\D/g, '') });
  },

  onStartDate(e) {
    this.setData({ startDate: e.detail.value });
    this.refreshDateError();
  },
  onEndDate(e) {
    this.setData({ endDate: e.detail.value });
    this.refreshDateError();
  },
  /** 即时提示：起止倒置在选完当下就点名，不等提交 */
  refreshDateError() {
    const { startDate, endDate } = this.data;
    const bad = startDate && endDate && endDate < startDate;
    this.setData({ dateError: bad ? `结束日期不能早于开始日期（${endDate} < ${startDate}）` : '' });
  },

  async onSubmit() {
    if (this.data.submitting) return;

    const title = String(this.data.title || '').trim();
    const description = String(this.data.description || '').trim();
    const { visibility, allowedTypes, startDate, endDate } = this.data;
    const memberRaw = String(this.data.memberLimit || '').trim();

    // 前端镜像服务端上限：违反时给「对象 + 实际值 + 上限」的提示，一个请求都不发
    if (title.length < 1 || title.length > MAX_TITLE) {
      return wx.showToast({ title: `标题需 1–${MAX_TITLE} 字，当前 ${title.length} 字`, icon: 'none' });
    }
    if (description.length > MAX_DESC) {
      return wx.showToast({ title: `描述最多 ${MAX_DESC} 字，当前 ${description.length} 字`, icon: 'none' });
    }
    if (!startDate || !endDate) {
      return wx.showToast({ title: '请选择开始和结束日期', icon: 'none' });
    }
    if (endDate < startDate) {
      return wx.showToast({ title: `结束日期不能早于开始日期（${endDate} < ${startDate}）`, icon: 'none' });
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
      const created = await api.post('/campaigns', {
        title,
        description,
        visibility,
        allowedTypes,
        memberLimit,
        startDate,
        endDate,
      });
      // 成功分支必须复位：wx.navigateTo 是「推送」详情页，本页仍留在导航栈里；
      // 若 submitting 仍为 true，用户从详情页返回后按钮会永久 disabled/loading、文案停在「创建中…」，
      // 且 onSubmit 被守卫短路，页面上没有任何重置路径 → 真用户被锁死（Critical-1）。
      this.setData({ submitting: false });
      wx.showToast({ title: '活动已创建', icon: 'success' });
      const id = created && created.id;
      wx.navigateTo({ url: `/pages/campaign-detail/campaign-detail?id=${id}` });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '创建失败', icon: 'none' });
      this.setData({ submitting: false });
    }
  },
});

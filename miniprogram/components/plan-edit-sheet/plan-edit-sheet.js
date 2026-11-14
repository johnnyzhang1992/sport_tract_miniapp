/**
 * 计划编辑半屏（创建 / 更改计划）：周期（每天/每周）+ 三项目标步进器，保存直接 PUT /plan。
 * 属性 visible/plan：plan 为空＝创建，有值＝按当前计划预填。
 * 事件：close（关闭）、saved（保存成功，event.detail=服务端返回的计划）
 */
const api = require('../../services/api');
const { PLAN_DEFAULTS, readDrafts, writeDrafts, validDraft, formOfPlan } = require('../../utils/plan-form');

Component({
  properties: {
    visible: { type: Boolean, value: false },
    plan: { type: Object, value: null },
  },

  data: {
    period: 'daily', // 2026-11-14 周计划下线：仅每日计划（周期切换 UI 移除）
    distanceKm: '',
    durationMin: '',
    count: '',
    drafts: {},
    saving: false,
  },

  observers: {
    visible(v) {
      if (v) this.init();
    },
  },

  methods: {
    /** 打开时初始化：有已保存计划 → 用它；否则用该周期草稿；再否则用默认值 */
    init() {
      const plan = this.data.plan;
      const drafts = readDrafts();
      const patch = { drafts };
      if (plan && plan.period) {
        const saved = formOfPlan(plan);
        // 周期固定 daily（2026-11-14 周计划下线）：不再继承 plan.period——
        // 存量周计划文档回传 'weekly' 会被 API 拒绝，用户就保存不了计划了
        patch.period = 'daily';
        drafts.daily = saved;
        Object.assign(patch, saved);
      } else {
        const cur = this.data.period || 'daily';
        const draft = validDraft(drafts[cur]) ? drafts[cur] : (PLAN_DEFAULTS[cur] || PLAN_DEFAULTS.daily);
        Object.assign(patch, draft);
      }
      this.setData(patch);
    },

    /** 输入变化统一落草稿 */
    saveDraft(patch) {
      const drafts = Object.assign({}, this.data.drafts);
      drafts[this.data.period] = {
        distanceKm: patch.distanceKm !== undefined ? patch.distanceKm : this.data.distanceKm,
        durationMin: patch.durationMin !== undefined ? patch.durationMin : this.data.durationMin,
        count: patch.count !== undefined ? patch.count : this.data.count,
      };
      writeDrafts(drafts);
      this.setData(Object.assign({ drafts }, patch));
    },

    /** 步进器：距离 0.5km / 时间 5 分钟 / 次数 1，下限不为 0 */
    onStep(e) {
      const { key, delta } = e.currentTarget.dataset;
      const step = Number(delta);
      if (!key || !step) return;
      if (key === 'distance') {
        const cur = Number(this.data.distanceKm) || 0;
        const next = Math.max(0.5, Math.min(500, cur + step * 0.5));
        this.saveDraft({ distanceKm: String(Math.round(next * 10) / 10) });
        return;
      }
      if (key === 'duration') {
        const cur = Number(this.data.durationMin) || 0;
        const next = Math.max(5, Math.min(10080, cur + step * 5));
        this.saveDraft({ durationMin: String(next) });
        return;
      }
      const cur = Number(this.data.count) || 0;
      const next = Math.max(1, Math.min(999, cur + step));
      this.saveDraft({ count: String(next) });
    },

    onDistance(e) {
      this.saveDraft({ distanceKm: String(e.detail.value || '').replace(/[^\d.]/g, '') });
    },
    onDuration(e) {
      this.saveDraft({ durationMin: String(e.detail.value || '').replace(/\D/g, '') });
    },
    onCount(e) {
      this.saveDraft({ count: String(e.detail.value || '').replace(/\D/g, '') });
    },

    onClose() {
      if (this.data.saving) return;
      this.triggerEvent('close');
    },
    noop() {},

    async onSave() {
      if (this.data.saving) return;
      const { period, distanceKm, durationMin, count } = this.data;
      const d = Number(distanceKm);
      const t = Number(durationMin);
      const c = Number(count);
      // 镜像服务端校验：三项都必须 > 0，且不超上限
      if (!Number.isFinite(d) || d <= 0 || d > 500) return wx.showToast({ title: '距离目标需 0–500 km', icon: 'none' });
      if (!Number.isInteger(t) || t <= 0 || t > 10080) return wx.showToast({ title: '时间目标需 0–10080 分钟', icon: 'none' });
      if (!Number.isInteger(c) || c <= 0 || c > 999) return wx.showToast({ title: '次数目标需 0–999 次', icon: 'none' });

      this.setData({ saving: true });
      try {
        const saved = await api.put('/plan', {
          period,
          targets: { distanceM: Math.round(d * 1000), durationMin: t, count: c },
        });
        wx.showToast({ title: '已保存', icon: 'success' });
        this.triggerEvent('saved', saved);
      } catch (e) {
        wx.showToast({ title: (e && e.message) || '保存失败', icon: 'none' });
      } finally {
        this.setData({ saving: false });
      }
    },
  },
});

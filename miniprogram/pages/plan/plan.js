/**
 * 运动计划设置页（pages/plan/plan）：周期（每天/每周）+ 三项目标（距离 km / 时间 分钟 / 次数）。
 * 进入即拉取当前计划与完成度；保存走 PUT /plan（服务端校验与上限见 services/exercise-plan.ts）。
 */
const api = require('../../services/api');

const PERIODS = [
  { key: 'daily', label: '每天' },
  { key: 'weekly', label: '每周' },
];

/** 无计划时的默认目标（按周期给出）：每天 3km/30 分钟/1 次；每周 21km/210 分钟/7 次 */
const PLAN_DEFAULTS = {
  daily: { distanceKm: '3', durationMin: '30', count: '1' },
  weekly: { distanceKm: '21', durationMin: '210', count: '7' },
};

Page({
  data: {
    periods: PERIODS,
    period: 'daily',
    distanceKm: '', // 字符串（输入框的值）；保存时换算米
    durationMin: '',
    count: '',
    // 当期进度摘要（来自 GET /plan/current 的 progress + plan.period）
    progressText: '',
    progressDetail: '',
    saving: false,
    loading: true,
    customized: false, // 用户是否手动改过目标：改过就不再套用周期默认值
  },

  onLoad() {
    this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      const d = await api.get('/plan/current');
      const t = (d && d.plan && d.plan.targets) || null;
      const progress = (d && d.progress) || { distanceM: 0, durationSec: 0, count: 0 };
      const patch = { loading: false };
      if (!t) {
        // 没有计划：按当前选择的周期预填默认目标，用户直接保存即可
        Object.assign(patch, PLAN_DEFAULTS[this.data.period] || PLAN_DEFAULTS.daily);
      }
      if (t) {
        patch.period = (d.plan.period === 'weekly') ? 'weekly' : 'daily';
        patch.distanceKm = String(Math.round(t.distanceM / 100) / 10); // 米 → km 一位小数
        patch.durationMin = String(t.durationMin || '');
        patch.count = String(t.count || '');
      }
      // 进度摘要：按计划周期的口径描述（无计划时也展示最近窗口的累计，引导设定目标）
      const periodLabel = d && d.plan ? (d.plan.period === 'weekly' ? '本周' : '今天') : '今天';
      patch.progressText = `${periodLabel}已完成`;
      patch.progressDetail = `${(progress.distanceM / 1000).toFixed(1)} km · ${Math.round(progress.durationSec / 60)} 分钟 · ${progress.count} 次`;
      this.setData(patch);
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
    }
  },

  onPeriod(e) {
    const key = e.currentTarget.dataset.value;
    if (!key || key === this.data.period) return;
    // 没手动改过目标时，切周期同时套用该周期的默认值（每天 3/30/1、每周 21/210/7）
    const patch = { period: key };
    if (!this.data.customized) Object.assign(patch, PLAN_DEFAULTS[key] || {});
    this.setData(patch);
  },

  /**
   * 步进器：− / + 快速调整。
   * 步长：距离 0.5km（一位小数）、时间 5 分钟、次数 1；下限停在最小值（三项都必须 > 0，不能减到 0）。
   */
  onStep(e) {
    const { key, delta } = e.currentTarget.dataset;
    const step = Number(delta);
    if (!key || !step) return;
    if (key === 'distance') {
      const cur = Number(this.data.distanceKm) || 0;
      const next = Math.max(0.5, Math.min(500, cur + step * 0.5));
      this.setData({ distanceKm: String(Math.round(next * 10) / 10), customized: true });
      return;
    }
    if (key === 'duration') {
      const cur = Number(this.data.durationMin) || 0;
      const next = Math.max(5, Math.min(10080, cur + step * 5));
      this.setData({ durationMin: String(next), customized: true });
      return;
    }
    if (key === 'count') {
      const cur = Number(this.data.count) || 0;
      const next = Math.max(1, Math.min(999, cur + step));
      this.setData({ count: String(next), customized: true });
    }
  },

  onDistance(e) {
    this.setData({ distanceKm: String(e.detail.value || '').replace(/[^\d.]/g, ''), customized: true });
  },

  onDuration(e) {
    this.setData({ durationMin: String(e.detail.value || '').replace(/\D/g, ''), customized: true });
  },

  onCount(e) {
    this.setData({ count: String(e.detail.value || '').replace(/\D/g, ''), customized: true });
  },

  async onSave() {
    if (this.data.saving) return;
    const { period, distanceKm, durationMin, count } = this.data;
    const distanceKmNum = Number(distanceKm);
    const durationNum = Number(durationMin);
    const countNum = Number(count);

    // 镜像服务端校验：三项必须都 > 0（三环固定）；上限距离 500km / 时长 10080 分钟 / 次数 999
    if (!Number.isFinite(distanceKmNum) || distanceKmNum <= 0 || distanceKmNum > 500) {
      return wx.showToast({ title: '距离目标需 0–500 km', icon: 'none' });
    }
    if (!Number.isInteger(durationNum) || durationNum <= 0 || durationNum > 10080) {
      return wx.showToast({ title: '时间目标需 0–10080 分钟', icon: 'none' });
    }
    if (!Number.isInteger(countNum) || countNum <= 0 || countNum > 999) {
      return wx.showToast({ title: '次数目标需 0–999 次', icon: 'none' });
    }

    this.setData({ saving: true });
    try {
      await api.put('/plan', {
        period,
        targets: { distanceM: Math.round(distanceKmNum * 1000), durationMin: durationNum, count: countNum },
      });
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },
});

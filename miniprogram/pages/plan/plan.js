/**
 * 运动计划设置页（pages/plan/plan）：周期（每天/每周）+ 三项目标（距离 km / 时间 分钟 / 次数）。
 * 进入即拉取当前计划与完成度；保存走 PUT /plan（服务端校验与上限见 services/exercise-plan.ts）。
 */
const api = require('../../services/api');

const PERIODS = [
  { key: 'daily', label: '每天' },
  { key: 'weekly', label: '每周' },
];

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
    if (key) this.setData({ period: key });
  },

  onDistance(e) {
    this.setData({ distanceKm: String(e.detail.value || '').replace(/[^\d.]/g, '') });
  },

  onDuration(e) {
    this.setData({ durationMin: String(e.detail.value || '').replace(/\D/g, '') });
  },

  onCount(e) {
    this.setData({ count: String(e.detail.value || '').replace(/\D/g, '') });
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

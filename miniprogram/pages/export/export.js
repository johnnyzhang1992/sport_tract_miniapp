const api = require('../../services/api');
const storage = require('../../services/storage');
const loading = require('../../utils/loading');
const config = require('../../config/index');
const { ensureLogin } = require('../../utils/login-gate');
const {
  EXPORT_RANGES, buildExportQuery, fileStamp, downloadExport, shareExportFile,
} = require('../../utils/export-file');

const TYPE_OPTIONS = [{ type: '', label: '全部类型' }].concat(
  config.ACTIVITY_TYPES.map((t) => ({ type: t.type, label: t.label })),
);

/** 东八区 'YYYY-MM-DD'（自定义日期默认值与 picker 边界用） */
function bjDate(ms) {
  const d = new Date(ms + 8 * 3600000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function defaultCustom() {
  const now = Date.now();
  return { start: bjDate(now - 29 * 86400000), end: bjDate(now) };
}

Page({
  data: {
    loggedIn: false,
    canExportBundle: false,
    memberLoaded: false,
    ranges: EXPORT_RANGES,
    types: TYPE_OPTIONS,
    today: bjDate(Date.now()),
    // 两种导出共用一套范围条件
    filter: { range: 'all', type: '', start: '', end: '' },
    busy: '', // 'csv' | 'gpx'：导出中锁住两个按钮
  },

  onShow() {
    const token = storage.getToken();
    const loggedIn = !!(token && token.accessToken);
    this.setData({ loggedIn, today: bjDate(Date.now()) });
    if (!loggedIn) {
      this.setData({ memberLoaded: false, canExportBundle: false });
      return;
    }
    this.loadMember();
  },

  /** 会员权益：拉不到按非会员（宁可少给，不可错给），也不阻塞 CSV 导出 */
  async loadMember() {
    try {
      const e = await api.get('/member/entitlements');
      this.setData({ canExportBundle: !!(e && e.canExportBundle), memberLoaded: true });
    } catch (err) {
      this.setData({ canExportBundle: false, memberLoaded: true });
    }
  },

  async guestLogin() {
    if (!(await ensureLogin('登录后才能导出你的运动数据。'))) return;
    this.onShow();
  },

  onRangeTap(e) {
    const key = e.detail && e.detail.key;
    if (!key) return;
    const patch = { 'filter.range': key };
    if (key === 'custom') {
      const d = defaultCustom();
      if (!this.data.filter.start) patch['filter.start'] = d.start;
      if (!this.data.filter.end) patch['filter.end'] = d.end;
    }
    this.setData(patch);
  },

  onTypeTap(e) {
    this.setData({ 'filter.type': (e.detail && e.detail.type) || '' });
  },

  onStartDate(e) {
    this.setData({ 'filter.start': e.detail.value });
  },

  onEndDate(e) {
    this.setData({ 'filter.end': e.detail.value });
  },

  goMember() {
    wx.navigateTo({ url: '/pages/member/member' });
  },

  onExportCsv() {
    return this.doExport('csv');
  },

  onExportGpx() {
    if (!this.data.canExportBundle) {
      wx.showToast({ title: '会员专属功能，开通后可导出轨迹', icon: 'none' });
      return undefined;
    }
    return this.doExport('gpx');
  },

  /** 生成 → 下载落盘 → 收 loading → 拉分享。失败文案优先用后端 message（超限/频控/会员）。 */
  async doExport(kind) {
    if (this.data.busy) return;
    const cond = this.data.filter;
    let query = '';
    try {
      query = buildExportQuery({
        rangeKey: cond.range,
        type: cond.type,
        startDate: cond.start,
        endDate: cond.end,
      });
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '筛选条件无效', icon: 'none' });
      return;
    }
    const path = kind === 'csv' ? '/activities/export/summary' : '/activities/export/gpx';
    const fileName = kind === 'csv'
      ? `运动记录_${fileStamp()}.csv`
      : `轨迹导出_${fileStamp()}.zip`;
    this.setData({ busy: kind });
    loading.show('生成中…');
    let filePath = '';
    try {
      filePath = await downloadExport(`${path}${query}`, fileName);
    } catch (err) {
      loading.hide();
      this.setData({ busy: '' });
      wx.showToast({ title: (err && err.message) || '导出失败', icon: 'none' });
      return;
    }
    loading.hide();
    try {
      await shareExportFile(filePath, fileName);
      wx.showToast({ title: '已导出', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '分享未完成', icon: 'none' });
    } finally {
      this.setData({ busy: '' });
    }
  },
});

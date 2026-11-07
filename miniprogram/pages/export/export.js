const api = require('../../services/api');
const storage = require('../../services/storage');
const loading = require('../../utils/loading');
const config = require('../../config/index');
const { ensureLogin } = require('../../utils/login-gate');
const {
  EXPORT_RANGES, buildExportQuery, buildStepExportQuery, fileStamp, downloadExport, shareExportFile,
} = require('../../utils/export-file');

/** 「单次上限」类错误的固定标志：这类消息必须整句读完才能照做，不能用 toast（会被截断） */
const LIMIT_ERROR_RE = /上限|超出|共 \d+ 条/;

function showExportError(message) {
  const text = String(message || '导出失败');
  if (LIMIT_ERROR_RE.test(text)) {
    wx.showModal({
      title: '超出单次导出上限',
      content: text,
      showCancel: false,
      confirmText: '知道了',
    });
    return;
  }
  wx.showToast({ title: text, icon: 'none' });
}

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
    // 三种导出共用一套范围条件（步数不用类型）
    filter: { range: 'all', type: '', start: '', end: '' },
    busy: '', // 'csv' | 'steps' | 'gpx'：导出中锁住全部按钮
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

  onExportStepsCsv() {
    return this.doExport('steps');
  },

  onExportGpx() {
    if (!this.data.canExportBundle) {
      wx.showToast({ title: '会员专属功能，开通后可导出轨迹', icon: 'none' });
      return undefined;
    }
    return this.doExport('gpx');
  },

  onExportFootprintCsv() {
    return this.doExport('footprints');
  },

  onExportPhotos() {
    if (!this.data.canExportBundle) {
      wx.showToast({ title: '会员专属功能，开通后可打包照片', icon: 'none' });
      return undefined;
    }
    return this.doExport('photos');
  },

  /** 生成 → 下载落盘 → 收 loading → 拉分享。失败文案优先用后端 message（超限/频控/会员）。 */
  async doExport(kind) {
    if (this.data.busy) return;
    const cond = this.data.filter;
    let query = '';
    try {
      if (kind === 'steps') {
        // 步数按自然日一条：固定档必须取「含今天共 N 个自然日」，不能沿用活动的滚动 24h
        query = buildStepExportQuery({ rangeKey: cond.range, startDate: cond.start, endDate: cond.end });
      } else {
        // 足迹/照片不吃运动类型（后端对应接口不收 type），活动/轨迹带类型
        const withType = kind !== 'footprints' && kind !== 'photos';
        query = buildExportQuery({
          rangeKey: cond.range,
          type: withType ? cond.type : '',
          startDate: cond.start,
          endDate: cond.end,
        });
      }
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '筛选条件无效', icon: 'none' });
      return;
    }
    const path = kind === 'csv'
      ? '/activities/export/summary'
      : kind === 'steps' ? '/werun/export/csv'
        : kind === 'footprints' ? '/footprint-records/export/csv'
          : kind === 'photos' ? '/activities/export/photos' : '/activities/export/gpx';
    const fileName = kind === 'csv'
      ? `运动记录_${fileStamp()}.csv`
      : kind === 'steps' ? `微信步数_${fileStamp()}.csv`
        : kind === 'footprints' ? `足迹记录_${fileStamp()}.csv`
          : kind === 'photos' ? `照片导出_${fileStamp()}.zip` : `轨迹导出_${fileStamp()}.zip`;
    this.setData({ busy: kind });
    loading.show('生成中…');
    let filePath = '';
    try {
      filePath = await downloadExport(`${path}${query}`, fileName);
    } catch (err) {
      loading.hide();
      this.setData({ busy: '' });
      showExportError(err && err.message);
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

const api = require('../../services/api');
const loading = require('../../utils/loading');
const config = require('../../config/index');
const { formatDuration } = require('../../utils/format');

Page({
  data: {
    activityTypes: config.ACTIVITY_TYPES,
    sourceOptions: [
      { value: '两步路', label: '两步路' },
      { value: 'Strava', label: 'Strava' },
      { value: '佳明', label: '佳明' },
      { value: '华为运动健康', label: '华为运动健康' },
      { value: '小米运动', label: '小米运动' },
      { value: 'Keep', label: 'Keep' },
    ],
    customSource: '',
    fileName: '',
    uploading: false,
    saving: false,
    preview: null,
    activityId: '',
  },

  /** 选择轨迹文件（从微信聊天记录） */
  chooseFile() {
    if (this.data.uploading) return;
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['gpx', 'kml', 'tcx'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) return;
        const name = file.name || 'track';
        if (!/\.(gpx|kml|tcx)$/i.test(name)) {
          wx.showToast({ title: '仅支持 .gpx/.kml/.tcx 文件', icon: 'none' });
          return;
        }
        this.upload(file);
      },
      fail: () => {},
    });
  },

  /** 上传解析（后端推断类型并创建活动） */
  async upload(file) {
    const app = getApp();
    // 已注册用户（本地有 token）静默恢复登录；游客不自动登录
    if (app.hasSession() && !app.globalData.loggedIn) {
      try {
        await app.login();
      } catch (e) {
        console.warn('静默登录失败', e);
      }
    }
    if (!app.globalData.loggedIn) return;
    this.setData({ uploading: true, fileName: file.name, preview: null, activityId: '' });
    loading.show('解析中…');
    try {
      const res = await api.uploadFile('/activities/import', file.path);
      this.setData({
        activityId: res.id,
        customSource: res.source || '',
        preview: {
          type: res.type,
          source: res.source || '其他',
          distanceKm: (res.distance / 1000).toFixed(2),
          durationText: formatDuration(res.duration),
          pointCount: res.pointCount,
        },
      });
    } catch (e) {
      loading.hide();
      wx.showToast({ title: e.message || '导入失败', icon: 'none' });
    } finally {
      loading.hide();
      this.setData({ uploading: false });
    }
  },

  /** 切换数据来源（预设或自定义） */
  onSourceChange(e) {
    const source = e.currentTarget.dataset.source;
    if (!this.data.preview || source === this.data.preview.source) return;
    this.setData({ 'preview.source': source });
  },

  onCustomSourceInput(e) {
    this.setData({ customSource: e.detail.value });
  },

  /** 当前选择的来源（自定义时用输入值） */
  currentSource() {
    const { preview, customSource } = this.data;
    if (!preview) return '';
    if (preview.source === '自定义') return (customSource || '').trim() || '其他';
    return preview.source;
  },

  /** 切换运动类型 */
  onTypeChange(e) {
    const type = e.currentTarget.dataset.type;
    if (!this.data.preview || type === this.data.preview.type) return;
    this.setData({ 'preview.type': type });
  },

  /** 确认保存（类型变化时同步修正后端） */
  async confirmSave() {
    if (!this.data.activityId || this.data.saving) return;
    const { preview, activityId } = this.data;
    this.setData({ saving: true });
    try {
      const body = {};
      if (preview.type) body.type = preview.type;
      body.source = this.currentSource();
      await api.put(`/activities/${activityId}/meta`, body);
      wx.showToast({ title: '导入成功', icon: 'success' });
      setTimeout(() => {
        wx.redirectTo({ url: `/pages/track-detail/track-detail?id=${activityId}` });
      }, 800);
    } catch (e) {
      console.error('保存失败', e);
      wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },
});

const api = require('../../services/api');
const { getToken } = require('../../services/storage');
const config = require('../../config/index');
const { formatDuration } = require('../../utils/format');

Page({
  data: {
    activityTypes: config.ACTIVITY_TYPES,
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
    if (!app.globalData.loggedIn) {
      try {
        await app.login();
      } catch (e) {
        wx.showToast({ title: '登录失败', icon: 'none' });
        return;
      }
    }
    this.setData({ uploading: true, fileName: file.name, preview: null, activityId: '' });
    wx.showLoading({ title: '解析中…' });
    try {
      const res = await new Promise((resolve, reject) => {
        wx.uploadFile({
          url: api.buildUrl('/activities/import'),
          filePath: file.path,
          name: 'file',
          header: { Authorization: `Bearer ${getToken()}` },
          success: (r) => {
            try {
              const body = JSON.parse(r.data);
              if (body.code !== 0 && body.code !== 200) {
                reject(new Error(body.message || '解析失败'));
                return;
              }
              resolve(body.data);
            } catch (e) {
              reject(new Error('解析失败：' + e.message));
            }
          },
          fail: () => reject(new Error('网络错误，请重试')),
        });
      });
      this.setData({
        activityId: res.id,
        preview: {
          type: res.type,
          distanceKm: (res.distance / 1000).toFixed(2),
          durationText: formatDuration(res.duration),
          pointCount: res.pointCount,
        },
      });
    } catch (e) {
      wx.showToast({ title: e.message || '导入失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ uploading: false });
    }
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
      if (preview.type) {
        await api.put(`/activities/${activityId}/type`, { type: preview.type });
      }
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

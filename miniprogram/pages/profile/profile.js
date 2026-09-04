/**
 * 资料编辑页（决策 F24）
 * - 头像：wx.chooseMedia → 微信合规检测（imgSecCheck）→ OSS 直传 → 保存 URL
 * - 昵称：保存时后端 msgSecCheck 检测（违规拒绝）
 */
const api = require('../../services/api');
const loading = require('../../utils/loading');
const { uploadPhoto } = require('../../services/oss-upload');
const config = require('../../config/index');
const { setProfileGuideDone } = require('../../services/storage');

Page({
  data: {
    user: null,
    avatarTemp: '', // 待上传的本地头像路径
    avatarUrl: '', // 当前头像 URL
    nickname: '',
    gender: 0, // 0 未知 1 男 2 女
    weightKg: 60,
    heightCm: 170,
    saving: false,
    fromGuide: false, // 首次注册引导进入（顶部展示完善资料说明）
    avatarSheetVisible: false, // 选择头像弹窗
    avatarPreset: '', // 默认头像预设 key（与上传头像互斥）
    defaultAvatars: config.DEFAULT_AVATARS, // 资源到位后非空，头像区显示预设网格
  },

  onLoad(options) {
    this.setData({ fromGuide: !!(options && options.from === 'guide') }); // 首次注册引导进入
    this.loadUser();
  },

  onShow() {
    // 从体重趋势页返回时同步最新体重（只覆盖体重，避免冲掉其他未保存编辑；首进时 user 未加载完跳过）
    if (!this.data.user) return;
    api.get('/users/me')
      .then((user) => this.setData({ weightKg: user.weightKg || 60 }))
      .catch(() => {});
  },

  async loadUser() {
    try {
      const user = await api.get('/users/me');
      this.setData({
        user,
        avatarUrl: user.avatarUrl || '',
        avatarPreset: user.avatarPreset || '',
        nickname: user.nickname || '',
        gender: user.gender || 0,
        weightKg: user.weightKg || 60,
        heightCm: user.heightCm || 170,
      });
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
      console.error(e);
    }
  },

  /** 选择头像 */
  chooseAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (file) {
          this.setData({ avatarTemp: file.tempFilePath, avatarPreset: '', avatarSheetVisible: false }); // 上传优先于预设
        }
      },
    });
  },

  /** 打开选择头像弹窗 */
  openAvatarSheet() {
    this.setData({ avatarSheetVisible: true });
  },

  closeAvatarSheet() {
    this.setData({ avatarSheetVisible: false });
  },

  noop() {},

  /** 选择默认头像预设（选中即清空上传态，并关闭弹窗） */
  selectDefaultAvatar(e) {
    this.setData({
      avatarPreset: e.currentTarget.dataset.key,
      avatarTemp: '',
      avatarUrl: '',
      avatarSheetVisible: false,
    });
  },

  onNicknameInput(e) {
    this.setData({ nickname: e.detail.value });
  },

  /** 体重趋势入口 */
  goWeightTrend() {
    wx.navigateTo({ url: '/pages/weight-trend/weight-trend' });
  },

  onGenderTap(e) {
    this.setData({ gender: Number(e.currentTarget.dataset.gender) });
  },

  onHeightInput(e) {
    this.setData({ heightCm: e.detail.value });
  },

  onWeightInput(e) {
    this.setData({ weightKg: e.detail.value });
  },

  /** 本地文件 md5（判断选的头像是否和上次上传的一样，避免重复上传浪费 CDN） */
  getFileMd5(filePath) {
    return new Promise((resolve) => {
      wx.getFileInfo({
        filePath,
        digestAlgorithm: 'md5',
        success: (res) => resolve(res.digest || ''),
        fail: () => resolve(''),
      });
    });
  },

  /** 保存：头像先合规检测 + 上传 OSS，再更新资料（昵称后端会再做合规检测） */
  async save() {
    if (this.data.saving) return;
    const nickname = this.data.nickname.trim();
    if (!nickname) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    loading.show('保存中…');

    try {
      const weight = Number(this.data.weightKg);
      const height = Number(this.data.heightCm);
      const body = {
        nickname,
        gender: this.data.gender,
        weightKg: weight >= 20 && weight <= 300 ? weight : undefined,
        heightCm: height >= 50 && height <= 250 ? height : undefined,
      };

      // 头像：有新选择才处理（uploadPhoto 内含微信合规检测，违规返回 blocked）
      if (this.data.avatarTemp) {
        // 判断头像是否变化：本地文件 md5 与上次上传一致且 URL 未变 → 复用旧头像，不重复上传
        const md5 = await this.getFileMd5(this.data.avatarTemp);
        const last = wx.getStorageSync('avatar_upload') || {};
        const unchanged = md5 && last.md5 === md5 && last.url === this.data.avatarUrl;
        if (!unchanged) {
          const up = await uploadPhoto(this.data.avatarTemp, {
            dir: 'avatar',
            prefix: 'avatar_',
          });
          if (up && up.blocked) {
            loading.hide();
            wx.showToast({ title: '头像包含不当内容', icon: 'none' });
            return;
          }
          if (up && up.url) {
            body.avatarUrl = up.url;
            wx.setStorageSync('avatar_upload', { md5, url: up.url });
          }
        }
        // unchanged：头像没变，不更新 avatarUrl（保持当前，避免重复上传）
        body.avatarPreset = ''; // 上传头像优先，清掉预设
      } else if (this.data.avatarPreset) {
        // 选择了默认头像预设：清空上传头像，保存预设 key
        body.avatarPreset = this.data.avatarPreset;
        body.avatarUrl = '';
      }

      const saved = await api.put('/users/me', body);
      loading.hide();
      wx.showToast({ title: '已保存', icon: 'success' });
      // 同步全局用户信息（体重/身高供运动卡路里计算使用）
      const app = getApp();
      if (app.globalData.userInfo) {
        app.globalData.userInfo.weightKg = saved.weightKg ?? (Number(this.data.weightKg) || 60);
        app.globalData.userInfo.heightCm = saved.heightCm ?? (Number(this.data.heightCm) || 170);
        app.globalData.userInfo.nickname = saved.nickname || this.data.nickname;
      }
      setProfileGuideDone(); // 保存过资料视为已完成首次引导（不再弹）
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) {
      loading.hide();
      const msg = (e && e.message) || '保存失败';
      wx.showToast({ title: msg.includes('不当内容') ? msg : '保存失败', icon: 'none' });
      console.error(e);
    } finally {
      this.setData({ saving: false });
    }
  },
});

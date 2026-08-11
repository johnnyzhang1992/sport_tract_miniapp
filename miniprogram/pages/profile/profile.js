/**
 * 资料编辑页（决策 F24）
 * - 头像：wx.chooseMedia → 微信合规检测（imgSecCheck）→ OSS 直传 → 保存 URL
 * - 昵称：保存时后端 msgSecCheck 检测（违规拒绝）
 */
const api = require('../../services/api');
const { uploadPhoto } = require('../../services/oss-upload');

Page({
  data: {
    user: null,
    avatarTemp: '', // 待上传的本地头像路径
    avatarUrl: '', // 当前头像 URL
    nickname: '',
    gender: 0, // 0 未知 1 男 2 女
    saving: false,
  },

  onLoad() {
    this.loadUser();
  },

  async loadUser() {
    try {
      const user = await api.get('/users/me');
      this.setData({
        user,
        avatarUrl: user.avatarUrl || '',
        nickname: user.nickname || '',
        gender: user.gender || 0,
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
          this.setData({ avatarTemp: file.tempFilePath });
        }
      },
    });
  },

  onNicknameInput(e) {
    this.setData({ nickname: e.detail.value });
  },

  onGenderTap(e) {
    this.setData({ gender: Number(e.currentTarget.dataset.gender) });
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
    wx.showLoading({ title: '保存中…' });

    try {
      const body = { nickname, gender: this.data.gender };

      // 头像：有新选择才上传（uploadPhoto 内含微信合规检测，违规返回 blocked）
      if (this.data.avatarTemp) {
        const up = await uploadPhoto(this.data.avatarTemp, {
          dir: 'avatar',
          prefix: 'avatar_',
        });
        if (up && up.blocked) {
          wx.hideLoading();
          wx.showToast({ title: '头像包含不当内容', icon: 'none' });
          return;
        }
        if (up && up.url) {
          body.avatarUrl = up.url;
        }
      }

      await api.put('/users/me', body);
      wx.hideLoading();
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) {
      wx.hideLoading();
      const msg = (e && e.message) || '保存失败';
      wx.showToast({ title: msg.includes('不当内容') ? msg : '保存失败', icon: 'none' });
      console.error(e);
    } finally {
      this.setData({ saving: false });
    }
  },
});

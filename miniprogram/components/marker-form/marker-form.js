/**
 * marker-form 打点弹窗（决策 F10/F11：类型 + 备注 + 可选拍照 + 地址）
 * props: visible, typeOptions, currentLocation
 * events: confirm({type, note, photoTempFile}) / cancel
 * 照片先由页面调用 services/oss-upload 上传，这里只选择临时文件
 */
const config = require('../../config/index');

Component({
  properties: {
    visible: { type: Boolean, value: false },
    /** 当前位置（打点坐标来源） */
    currentLocation: { type: Object, value: null },
  },

  data: {
    typeOptions: config.MARKER_TYPES,
    selectedType: 'checkpoint',
    note: '',
    photoTempFile: '',
  },

  observers: {
    visible(v) {
      if (v) {
        this.setData({ selectedType: 'checkpoint', note: '', photoTempFile: '' });
      }
    },
  },

  methods: {
    selectType(e) {
      this.setData({ selectedType: e.currentTarget.dataset.type });
    },

    onNoteInput(e) {
      this.setData({ note: e.detail.value });
    },

    /** 拍照/相册 */
    choosePhoto() {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['camera', 'album'],
        sizeType: ['compressed'],
        success: (res) => {
          const file = res.tempFiles && res.tempFiles[0];
          if (file) {
            this.setData({ photoTempFile: file.tempFilePath });
          }
        },
      });
    },

    removePhoto() {
      this.setData({ photoTempFile: '' });
    },

    confirm() {
      this.triggerEvent('confirm', {
        type: this.data.selectedType,
        note: this.data.note.trim(),
        photoTempFile: this.data.photoTempFile,
      });
    },

    cancel() {
      this.triggerEvent('cancel');
    },

    noop() {},
  },
});

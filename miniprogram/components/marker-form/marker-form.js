/**
 * marker-form 打点弹窗（决策 F10/F11/F13）
 * - 新增模式：类型 + 备注 + 可选拍照（照片先由页面调 services/oss-upload 上传）
 * - 编辑模式（editMode=true + marker 传入）：类型/备注预填，显示删除按钮
 * events:
 *   confirm({markerId?, type, note, photoTempFile})  新增或编辑确认
 *   delete({markerId})                               编辑模式点删除
 *   cancel()
 */
const config = require('../../config/index');

Component({
  properties: {
    visible: { type: Boolean, value: false },
    /** 当前位置（新增模式打点坐标来源） */
    currentLocation: { type: Object, value: null },
    /** 编辑模式 */
    editMode: { type: Boolean, value: false },
    /** 编辑的打点（editMode 时传入） */
    marker: { type: Object, value: null },
  },

  data: {
    typeOptions: config.MARKER_TYPES,
    selectedType: 'checkpoint',
    note: '',
    photoTempFile: '',
  },

  observers: {
    'visible, marker': function (visible, marker) {
      if (!visible) return;
      if (this.data.editMode && marker) {
        // 编辑模式：预填
        this.setData({
          selectedType: marker.type || 'checkpoint',
          note: marker.note || '',
          photoTempFile: '',
        });
      } else {
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
        markerId: this.data.editMode && this.data.marker ? this.data.marker.id : undefined,
        type: this.data.selectedType,
        note: this.data.note.trim(),
        photoTempFile: this.data.photoTempFile,
      });
    },

    /** 编辑模式删除 */
    del() {
      const marker = this.data.marker;
      if (marker && marker.id) {
        this.triggerEvent('delete', { markerId: marker.id });
      }
    },

    cancel() {
      this.triggerEvent('cancel');
    },

    noop() {},
  },
});

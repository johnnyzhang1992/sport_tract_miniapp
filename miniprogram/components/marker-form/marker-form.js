/**
 * marker-form 打点弹窗（决策 F10/F11/F13）
 * - 新增模式：类型 + 备注 + 多张照片（≤3，可逐张删除）
 * - 编辑模式（editMode=true + marker 传入）：类型/备注预填，显示删除按钮
 * events:
 *   confirm({markerId?, type, note, photos})   photos: 待上传的本地临时路径数组
 *   delete({markerId}) / cancel()
 */
const config = require('../../config/index');

const MAX_PHOTOS = 3;

Component({
  properties: {
    visible: { type: Boolean, value: false },
    currentLocation: { type: Object, value: null },
    editMode: { type: Boolean, value: false },
    marker: { type: Object, value: null },
  },

  data: {
    typeOptions: config.MARKER_TYPES,
    selectedType: 'checkpoint',
    note: '',
    photos: [], // 待上传的本地临时路径（新增模式）
    maxPhotos: MAX_PHOTOS,
  },

  observers: {
    'visible, marker': function (visible, marker) {
      if (!visible) return;
      if (this.data.editMode && marker) {
        this.setData({ selectedType: marker.type || 'checkpoint', note: marker.note || '', photos: [] });
      } else {
        this.setData({ selectedType: 'checkpoint', note: '', photos: [] });
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

    /** 拍照/相册（多选，最多 MAX_PHOTOS 张，与已选去重） */
    choosePhoto() {
      const remaining = MAX_PHOTOS - this.data.photos.length;
      if (remaining <= 0) {
        wx.showToast({ title: `最多 ${MAX_PHOTOS} 张照片`, icon: 'none' });
        return;
      }
      wx.chooseMedia({
        count: remaining,
        mediaType: ['image'],
        sourceType: ['camera', 'album'],
        sizeType: ['compressed'],
        success: (res) => {
          const paths = (res.tempFiles || []).map((f) => f.tempFilePath);
          // 去重后拼接
          const merged = this.data.photos.concat(paths.filter((p) => !this.data.photos.includes(p)));
          this.setData({ photos: merged.slice(0, MAX_PHOTOS) });
        },
      });
    },

    removePhoto(e) {
      const idx = Number(e.currentTarget.dataset.idx);
      const photos = this.data.photos.filter((_, i) => i !== idx);
      this.setData({ photos });
    },

    confirm() {
      this.triggerEvent('confirm', {
        markerId: this.data.editMode && this.data.marker ? this.data.marker.id : undefined,
        type: this.data.selectedType,
        note: this.data.note.trim(),
        photos: this.data.photos,
      });
    },

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

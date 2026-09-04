/**
 * marker-form 打点弹窗（决策 F10/F11/F13）
 * - 新增模式：类型 + 备注 + 多张照片（≤3，可逐张删除）
 * - 编辑模式：类型/备注预填 + 已有照片预览（可删除）+ 补拍新图 + 删除打点
 * events:
 *   confirm({markerId?, type, note, photos, existingPhotos})
 *     photos: 新选本地路径数组；existingPhotos: 编辑模式保留的已有 URL 数组
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
    presets: config.MARKER_ICON_PRESETS,
    selectedIcon: '📍',
    label: '', // 打点文案（可自定义）
    selectedType: 'checkpoint',
    note: '',
    photos: [], // 新选待上传（本地路径）
    existingPhotos: [], // 编辑模式已有照片（URL，可删除）
    maxPhotos: MAX_PHOTOS,
  },

  observers: {
    'visible, marker': function (visible, marker) {
      if (!visible) return;
      if (this.data.editMode && marker) {
        // 已有照片：photos + photoUrl 合并，按裸 URL（去 query）去重
        // 注意：签名 URL 每次生成不同，必须按去参数后的地址判断是否同一张图
        const merged = [...(marker.photos || []), ...(marker.photoUrl ? [marker.photoUrl] : [])];
        const seen = new Set();
        const existingPhotos = merged.filter((u) => {
          if (!u) return false;
          const bare = String(u).split('?')[0];
          if (seen.has(bare)) return false;
          seen.add(bare);
          return true;
        });
        const preset = config.MARKER_ICON_PRESETS.find((p) => p.icon === marker.icon);
        this.setData({
          selectedType: marker.type || 'checkpoint',
          selectedIcon: marker.icon || (preset && preset.icon) || '📍',
          label: marker.label || (marker.type && !marker.icon ? (config.MARKER_TYPES.find((t) => t.type === marker.type) || {}).label : '') || '',
          note: marker.note || '',
          photos: [],
          existingPhotos,
        });
      } else {
        this.setData({ selectedType: 'checkpoint', selectedIcon: '📍', label: '', note: '', photos: [], existingPhotos: [] });
      }
    },
  },

  methods: {
    /** 选图标预设：设定图标 + 统计归类；文案为空或等于其他预设默认文案时才跟随（不覆盖用户自拟） */
    selectPreset(e) {
      const { icon, label, category } = e.currentTarget.dataset;
      const keep = this.data.label === '' || config.MARKER_ICON_PRESETS.some((p) => p.label === this.data.label);
      this.setData({
        selectedIcon: icon,
        selectedType: category,
        label: keep ? label : this.data.label,
      });
    },

    onLabelInput(e) {
      this.setData({ label: e.detail.value });
    },

    onNoteInput(e) {
      this.setData({ note: e.detail.value });
    },

    /** 拍照/相册（多选，总量 ≤ MAX_PHOTOS，与已选去重） */
    choosePhoto() {
      const total = this.data.existingPhotos.length + this.data.photos.length;
      const remaining = MAX_PHOTOS - total;
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
          const merged = this.data.photos.concat(paths.filter((p) => !this.data.photos.includes(p)));
          this.setData({ photos: merged.slice(0, MAX_PHOTOS - this.data.existingPhotos.length) });
        },
      });
    },

    /** 删除新选照片 */
    removePhoto(e) {
      const idx = Number(e.currentTarget.dataset.idx);
      this.setData({ photos: this.data.photos.filter((_, i) => i !== idx) });
    },

    /** 删除已有照片（编辑模式） */
    removeExistingPhoto(e) {
      const idx = Number(e.currentTarget.dataset.idx);
      this.setData({ existingPhotos: this.data.existingPhotos.filter((_, i) => i !== idx) });
    },

    confirm() {
      this.triggerEvent('confirm', {
        markerId: this.data.editMode && this.data.marker ? this.data.marker.id : undefined,
        type: this.data.selectedType,
        icon: this.data.selectedIcon,
        label: this.data.label.trim().slice(0, 20),
        note: this.data.note.trim(),
        photos: this.data.photos,
        existingPhotos: this.data.existingPhotos,
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

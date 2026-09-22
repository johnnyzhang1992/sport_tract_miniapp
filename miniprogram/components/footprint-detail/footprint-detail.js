// 足迹详情半屏（地图页与列表页共用）：轻量数据缺字段时自行补拉 GET /:id（seq 守卫防连点覆盖），
// 内置 看图/编辑/删除；事件：close（关闭）、edit（带完整记录，父级转开表单）、deleted（删除成功，父级刷新）。
const api = require('../../services/api');

Component({
  properties: {
    visible: { type: Boolean, value: false },
    record: { type: Object, value: null }, // geo/列表卡的轻量 DTO 即可，缺描述/人物/照片时补拉
    // tab 页的弹层底边在 tabBar 上方，不含屏幕底部安全区，由页面传 false
    safeBottom: { type: Boolean, value: true },
  },
  observers: {
    'visible, record': function (visible) {
      if (visible) this.load();
    },
  },
  data: {
    detail: null, // 装饰后的完整记录（WXML 不能 join 数组，展示字段先算好）
    loading: false,
  },
  methods: {
    load() {
      const record = this.data.record;
      if (!record || !record.id) return;
      const seq = (this._seq = (this._seq || 0) + 1);
      // 列表卡自带 photoThumbs 就不必补拉；缺字段（地图 geo 那一路）才拉完整详情
      const need = !record.location || record.description === undefined || record.people === undefined || record.photoThumbs === undefined;
      if (!need) {
        this.setData({ detail: this.decorate(record), loading: false });
        return;
      }
      this.setData({ detail: null, loading: true }); // 清旧详情：避免上一次打开的内容闪一帧
      api
        .get('/footprint-records/' + record.id)
        .then((full) => {
          if (seq === this._seq) this.setData({ detail: this.decorate(full), loading: false });
        })
        .catch((e) => {
          if (seq !== this._seq) return;
          this.setData({ loading: false });
          wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
          this.triggerEvent('close');
        });
    },
    decorate(full) {
      const loc = full.location || {};
      const people = Array.isArray(full.people) ? full.people.filter(Boolean) : [];
      const photos = Array.isArray(full.photos) ? full.photos.filter(Boolean) : [];
      // 半屏里的格子只有 200rpx，一律用缩略图档；photos 只在 previewImage 时才拉
      const photoThumbs = Array.isArray(full.photoThumbs) ? full.photoThumbs.filter(Boolean) : photos;
      const place = loc.city || loc.address || loc.name || '';
      return Object.assign({}, full, {
        people,
        peopleText: people.join('、'),
        photos,
        photoThumbs,
        metaText: [full.visitDate, place].filter(Boolean).join(' · '),
      });
    },

    onClose() { this.triggerEvent('close'); },
    onMaskTap() { this.triggerEvent('close'); },
    noop() {},
    onEdit() {
      const rec = this.data.detail;
      if (!rec) return;
      this.triggerEvent('edit', rec);
    },
    onDelete() {
      const rec = this.data.detail;
      if (!rec) return;
      wx.showModal({
        title: '删除足迹',
        content: '确定删除「' + rec.title + '」？照片将一并移除',
        confirmColor: '#e54d42',
        success: (res) => {
          if (!res.confirm) return;
          api
            .del('/footprint-records/' + rec.id)
            .then(() => {
              wx.showToast({ title: '已删除', icon: 'success' });
              this.triggerEvent('deleted');
            })
            .catch((e) => wx.showToast({ title: (e && e.message) || '删除失败', icon: 'none' }));
        },
      });
    },
    previewPhoto(e) {
      const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
      const idx = Number(ds.idx) || 0;
      const detail = this.data.detail;
      if (!detail) return;
      const show = (urls) => {
        const list = (Array.isArray(urls) ? urls : []).filter(Boolean);
        if (list.length === 0) {
          wx.showToast({ title: `这条足迹的 ${idx + 1} 号照片没有可访问地址`, icon: 'none' });
          return;
        }
        wx.previewImage({ urls: list, current: list[idx] || list[0] });
      };
      // 格子是缩略图档，preview 必须用原图；老版本 DTO 没带 photos 时点开才补拉
      if (detail.photos && detail.photos.length) {
        show(detail.photos);
        return;
      }
      api
        .get('/footprint-records/' + detail.id)
        .then((full) => {
          if (full && full.photos) this.setData({ detail: this.decorate(full) });
          show(full && full.photos);
        })
        .catch((err) => wx.showToast({ title: (err && err.message) || '原图加载失败', icon: 'none' }));
    },
  },
});

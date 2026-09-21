// 足迹新增/编辑表单（半屏弹层组件）：在足迹 tab 内就地打开，不跳页面；保存成功后由页面刷新地图/列表。
// 图片链：点缩略图 wx.editImage 编辑 → 提交时合规检测（q50 检测副本 ≤1MB）→ q80 存档副本直传 OSS
// 键盘：输入框 adjust-position=false，bindkeyboardheightchange 抬升弹层 + scroll-into-view 露出焦点字段
const api = require('../../services/api');
const { uploadPhoto, editImage } = require('../../services/oss-upload');

const MAX_PHOTOS = 3;
/** 键盘弹起时弹层顶与屏幕上沿之间的留白（px） */
const SHEET_TOP_GAP = 48;
/** 无键盘时的弹层样式（弹层高度调这里）；键盘弹起时抬升至键盘上方并缩高，见 onKeyboardHeight */
const SHEET_DEFAULT_STYLE = 'bottom:0;height:78vh;';

Component({
  options: { addGlobalClass: true }, // 复用 app.wxss 的 .card / .btn-primary / .text-muted
  properties: {
    visible: { type: Boolean, value: false },
    record: { type: Object, value: null }, // 传记录 = 编辑态（详情弹窗的完整 DTO 直接回填）
    // tab 页的弹层底边在 tabBar 上方，不含屏幕底部安全区，由页面传 false
    safeBottom: { type: Boolean, value: true },
    // 页面是否 tab 页：tab 页 fixed 基准是 tabBar 上沿，而键盘高度是屏幕基准，
    // 抬升量需减去 (screenHeight - windowHeight) 才能贴住键盘上沿
    onTab: { type: Boolean, value: false },
  },
  observers: {
    // 只在「打开」时初始化：可见期间父级换 record 不重来，避免覆盖用户正在编辑的内容
    'visible, record': function (visible) {
      if (visible) this.init();
    },
  },
  data: {
    isEdit: false,
    id: '',
    visitDate: '',
    title: '',
    people: [],
    peopleInput: '',
    description: '',
    location: null, // {name,address,latitude,longitude}
    photos: [], // [{ url: 已上传URL, localPath: 本地临时文件|null }]
    submitting: false,
    canSubmit: false,
    kbHeight: 0,
    sheetStyle: SHEET_DEFAULT_STYLE,
    scrollTarget: '',
  },
  methods: {
    /** 打开初始化：编辑态回填；新增态全量清空（上一次的残留必须清掉） */
    init() {
      const rec = this.data.record;
      const edit = Boolean(rec && rec.id);
      this.setData({
        isEdit: edit,
        id: edit ? rec.id : '',
        visitDate: edit ? rec.visitDate : this.today(),
        title: edit ? rec.title || '' : '',
        people: edit && Array.isArray(rec.people) ? rec.people.slice() : [],
        peopleInput: '',
        description: edit ? rec.description || '' : '',
        location: edit ? rec.location || null : null,
        photos: edit ? (rec.photos || []).filter(Boolean).map((url) => ({ url, localPath: null })) : [],
        submitting: false,
        kbHeight: 0,
        sheetStyle: SHEET_DEFAULT_STYLE,
        scrollTarget: '',
      });
      this.refreshCanSubmit();
    },
    today() {
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    },

    onClose() { this.triggerEvent('close'); },
    onMaskTap() { this.triggerEvent('close'); },
    noop() {},

    onDate(e) {
      this.setData({ visitDate: e.detail.value });
      this.refreshCanSubmit();
    },
    onTitle(e) {
      this.setData({ title: e.detail.value });
      this.refreshCanSubmit();
    },
    onDesc(e) { this.setData({ description: e.detail.value }); },
    onPeopleInput(e) { this.setData({ peopleInput: e.detail.value }); },
    addPerson() {
      const name = this.data.peopleInput.trim();
      if (!name) return;
      if (this.data.people.length >= 10) return wx.showToast({ title: '人物最多 10 个', icon: 'none' });
      if (this.data.people.includes(name)) return this.setData({ peopleInput: '' });
      this.setData({ people: this.data.people.concat(name), peopleInput: '' });
    },
    removePerson(e) {
      const i = Number(e.currentTarget.dataset.idx);
      this.setData({ people: this.data.people.filter((_, j) => j !== i) });
    },

    /** 选点：wx.chooseLocation（免费，自带搜索+地图点选） */
    pickByWx() {
      wx.chooseLocation({
        success: (res) => {
          this.setData({
            location: { name: res.name || res.address, address: res.address, latitude: res.latitude, longitude: res.longitude },
          });
          this.refreshCanSubmit();
        },
        fail: (e) => {
          if (String(e.errMsg).includes('auth deny')) wx.showToast({ title: '需要位置权限才能选点', icon: 'none' });
        },
      });
    },
    /** 点缩略图：拉起微信原生编辑（裁剪/涂鸦/文字/马赛克），结果替换该图；已存 OSS 的旧图不支持 */
    async editPhoto(e) {
      const i = Number(e.currentTarget.dataset.idx);
      const p = this.data.photos[i];
      if (!p) return;
      if (!p.localPath) return wx.showToast({ title: '已保存的照片暂不支持编辑', icon: 'none' });
      if (typeof wx.editImage !== 'function') {
        return wx.showToast({ title: '当前微信版本不支持图片编辑', icon: 'none' });
      }
      const edited = await editImage(p.localPath);
      if (edited) this.setData({ [`photos[${i}].localPath`]: edited });
    },

    /** 选图（压缩/上传都在提交时做，避免浪费 OSS 流量） */
    choosePhoto() {
      const remaining = MAX_PHOTOS - this.data.photos.length;
      if (remaining <= 0) return wx.showToast({ title: `最多 ${MAX_PHOTOS} 张`, icon: 'none' });
      wx.chooseMedia({
        count: remaining,
        mediaType: ['image'],
        sourceType: ['camera', 'album'],
        sizeType: ['compressed'],
        success: (res) => {
          const picked = res.tempFiles.map((f) => f.tempFilePath).filter((p) => !this.data.photos.some((x) => x.localPath === p));
          this.setData({ photos: this.data.photos.concat(picked.map((p) => ({ url: '', localPath: p }))).slice(0, MAX_PHOTOS) });
        },
      });
    },
    removePhoto(e) {
      const i = Number(e.currentTarget.dataset.idx);
      this.setData({ photos: this.data.photos.filter((_, j) => j !== i) });
    },

    // 键盘：抬高弹层 + 滚到焦点字段（adjust-position=false 时系统不会顶起页面）
    onFieldFocus(e) {
      const id = (e.currentTarget && e.currentTarget.id) || '';
      if (id) this.setData({ scrollTarget: id });
    },
    onFieldBlur() { this.setData({ scrollTarget: '' }); },
    onKeyboardHeight(e) {
      const h = Number((e.detail && e.detail.height) || 0);
      if (h === this.data.kbHeight) return;
      // 键盘高度是屏幕基准；tab 页 fixed 弹层的 bottom 基准是 tabBar 上沿（页面可视区底部）。
      // 两者基准差 = screenHeight - windowHeight，tab 页需从抬升量中扣除，否则弹层多抬一段露出背景地图
      let lift = h;
      if (h > 0 && this.data.onTab) {
        try {
          const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
          lift = Math.max(0, h - Math.max(0, (info.screenHeight || 0) - (info.windowHeight || 0)));
        } catch (err) {}
      }
      // iOS 已知问题：键盘弹起时 webview 会被整体上推（即使 adjust-position=false），
      // position:fixed 的弹层随之错位——表现为弹层和键盘之间露出一条页面背景。
      // 标准解法（社区共识）：键盘开/合时立刻把页面滚动位置强制复位，再按键盘高度抬升弹层
      wx.pageScrollTo({ scrollTop: 0, duration: 0 }).catch(() => {});
      this.setData({
        kbHeight: h,
        sheetStyle: lift > 0 ? `bottom:${lift}px;height:calc(100vh - ${lift + SHEET_TOP_GAP}px);` : SHEET_DEFAULT_STYLE,
      });
    },

    refreshCanSubmit() {
      const d = this.data;
      this.setData({ canSubmit: Boolean(d.visitDate && d.title.trim() && d.location) });
    },

    // 中途失败重试会把已上传的对象留在 OSS（孤儿文件）：不回填 url 就不进库，
    // 换来的是"失败不丢已传图"，属既定取舍（后端删除足迹时按库内 URL 清理）
    async uploadPending() {
      const out = [];
      for (let i = 0; i < this.data.photos.length; i++) {
        const p = this.data.photos[i];
        if (!p.localPath) {
          out.push(p.url);
          continue;
        } // 已有图：保留（服务端 cleanUrl 归一签名）
        const r = await uploadPhoto(p.localPath, { dir: 'footprints', prefix: 'fp_' });
        if (r && r.tooLarge) {
          const mb = (r.sizeBytes / 1024 / 1024).toFixed(1);
          throw new Error(`第 ${i + 1} 张照片压缩后仍约 ${mb}MB，超过 1MB 上限，请换一张`);
        }
        if (!r) throw new Error('照片上传失败，请重试');
        if (r.blocked) {
          wx.showToast({ title: '照片含违规内容已移除', icon: 'none' });
          continue;
        }
        out.push(r.url);
      }
      return out;
    },

    async submit() {
      if (!this.data.canSubmit || this.data.submitting) return;
      this.setData({ submitting: true });
      try {
        const photos = await this.uploadPending();
        const payload = {
          visitDate: this.data.visitDate,
          title: this.data.title.trim(),
          people: this.data.people,
          description: this.data.description.trim(),
          location: {
            name: this.data.location.name,
            address: this.data.location.address,
            latitude: this.data.location.latitude,
            longitude: this.data.location.longitude,
          },
          photos,
        };
        if (this.data.isEdit) await api.put(`/footprint-records/${this.data.id}`, payload);
        else await api.post('/footprint-records', payload);
        wx.showToast({ title: '已保存', icon: 'success' });
        this.triggerEvent('saved');
      } catch (e) {
        wx.showToast({ title: e.message || '保存失败', icon: 'none' });
        this.setData({ submitting: false });
      }
    },
  },
});

// 足迹新增/编辑表单：地点（wx.chooseLocation）→ 日期 → 标题 → 人物 → 描述 → 图片（≤3）→ 提交
// 图片：点缩略图拉起微信原生编辑（裁剪/涂鸦/文字/马赛克）；提交时走「q50 检测副本 → q80 存档副本直传 OSS」
// 保存成功后置 globalData.footprintsDirty，回 tab 时 onShow 重拉列表
const api = require('../../../services/api');
const { uploadPhoto, editImage } = require('../../../services/oss-upload');
const MAX_PHOTOS = 3;

Page({
  data: {
    id: '',
    visitDate: '',
    title: '',
    people: [],
    peopleInput: '',
    description: '',
    location: null, // {name,address,latitude,longitude}
    photos: [], // [{ url: 已上传裸/签名URL, localPath: 临时文件|null }]
    submitting: false,
    canSubmit: false,
  },
  onLoad(q) {
    this.setData({ visitDate: this.today() });
    if (q && q.id) {
      this.setData({ id: q.id });
      wx.setNavigationBarTitle({ title: '编辑足迹' });
      api.get(`/footprint-records/${q.id}`).then((r) => {
        this.setData({
          visitDate: r.visitDate,
          title: r.title || '',
          people: r.people || [],
          description: r.description || '',
          location: r.location,
          photos: (r.photos || []).map((url) => ({ url, localPath: null })),
        });
        this.refreshCanSubmit();
      }).catch((e) => {
        // 加载失败必须清 id：否则表单半成品 + 用户重填保存会走 PUT，
        // photos 为空会被服务端差集当成「删图」，误删该记录已有 OSS 照片。
        // 清 id 后保存走新增；location 置 null 使 canSubmit 为 false，逼用户重新选点。
        wx.showToast({ title: e.message || '加载足迹失败', icon: 'none' });
        this.setData({ id: '', location: null });
        // 慢 GET 窄竞态：详情还在飞时用户已自行选点/填标题（refreshCanSubmit 已把按钮打开），
        // 本次 catch 把 location 清空却不会自动关掉按钮 → 提交仍可用而地点为空，submit 读
        // this.data.location.name 直接抛错。置空后必须同步重算一次。
        this.refreshCanSubmit();
      });
    }
  },
  today() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  },
  onDate(e) {
    this.setData({ visitDate: e.detail.value });
    this.refreshCanSubmit();
  },
  onTitle(e) {
    this.setData({ title: e.detail.value });
    this.refreshCanSubmit();
  },
  onDesc(e) {
    this.setData({ description: e.detail.value });
  },
  onPeopleInput(e) {
    this.setData({ peopleInput: e.detail.value });
  },
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

  refreshCanSubmit() {
    const d = this.data;
    this.setData({ canSubmit: Boolean(d.visitDate && d.title.trim() && d.location) });
  },

  /** 选图→压缩→（上传在提交时做，避免浪费 OSS 流量） */
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
      if (this.data.id) await api.put(`/footprint-records/${this.data.id}`, payload);
      else await api.post('/footprint-records', payload);
      getApp().globalData.footprintsDirty = true;
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) {
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
      this.setData({ submitting: false });
    }
  },
});

// 足迹 tab 主页壳（Task 4）：地图/列表切换 + 数据加载骨架；地图 marker/弹窗 Task 5、列表形态 Task 6 填充
const api = require('../../services/api');

Page({
  data: {
    mode: 'map', // map | list
    loading: true,
    error: '',
    records: [], // /geo 轻量点缓存 {id,title,visitDate,latitude,longitude,coverPhoto}
    markers: [],
    items: [], page: 1, pageSize: 20, total: 0, hasMore: true, loadingList: false,
    popup: { visible: false, record: null },
  },
  onLoad() { this.loadAll(); },
  onShow() {
    const app = getApp();
    if (app.globalData.footprintsDirty) {
      app.globalData.footprintsDirty = false;
      this.loadAll();
    }
  },
  onPullDownRefresh() { this.loadAll().finally(() => wx.stopPullDownRefresh()); },
  async loadAll() {
    this.setData({ loading: true, error: '' });
    const seq = (this._seq = (this._seq || 0) + 1); // 请求序号守卫：只应用最后一次结果，防闪屏/竞态
    try {
      await Promise.all([this.loadGeo(seq), this.reloadList(seq)]);
      this.setData({ loading: false });
    } catch (e) {
      if (seq !== this._seq) return;
      this.setData({ loading: false, error: e.message || '加载失败' });
    }
  },
  loadGeo(seq) {
    return api.get('/footprint-records/geo').then((data) => {
      if (seq !== this._seq) return;
      this.setData({ records: data.items });
      this.buildMarkers();
    });
  },
  reloadList(seq) {
    this.setData({ items: [], page: 1, hasMore: true });
    return this.fetchPage(seq || this._seq);
  },
  fetchPage(seq) {
    this.setData({ loadingList: true });
    return api
      .get('/footprint-records', { page: this.data.page, pageSize: this.data.pageSize })
      .then((data) => {
        if (seq !== this._seq) return;
        const items = this.data.items.concat(data.items);
        this.setData({ items, total: data.total, hasMore: items.length < data.total, loadingList: false });
      })
      .catch((e) => { this.setData({ loadingList: false }); throw e; });
  },
  buildMarkers() { /* Task 5 实现 */ },
  switchMode(e) { this.setData({ mode: e.currentTarget.dataset.mode }); },
  openAdd() { wx.navigateTo({ url: '/packageFootRecords/pages/record-edit/record-edit' }); },
  noop() {},
});

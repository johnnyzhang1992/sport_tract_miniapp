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
    // 请求序号守卫：只应用最后一次结果，防竞态
    const seq = (this._seq = (this._seq || 0) + 1);
    // 仅首屏（records/items 都还没内容）才进 loading 态；下拉/footprintsDirty 刷新保留已渲染内容，防闪屏
    const firstLoad = this.data.records.length === 0 && this.data.items.length === 0;
    this.setData(firstLoad ? { loading: true, error: '' } : { error: '' });
    try {
      await Promise.all([this.loadGeo(seq), this.reloadList(seq)]);
      this.setData({ loading: false });
    } catch (e) {
      if (seq !== this._seq) return;
      // 最新一次请求失败也要复位 loadingList，否则 Task 6 触底闸门会卡死或重复发请求
      this.setData({ loading: false, loadingList: false, error: e.message || '加载失败' });
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
    // 不提前清空 items：第一页响应到达后再整体替换（见 fetchPage），刷新时列表不留空窗
    this.setData({ page: 1, hasMore: true });
    return this.fetchPage(seq || this._seq);
  },
  fetchPage(seq) {
    this.setData({ loadingList: true });
    const page = this.data.page;
    return api
      .get('/footprint-records', { page, pageSize: this.data.pageSize })
      .then((data) => {
        if (seq !== this._seq) return;
        // page 1（首屏/刷新）替换整页；page > 1（Task 6 触底）追加
        const items = page === 1 ? data.items : this.data.items.concat(data.items);
        this.setData({ items, total: data.total, hasMore: items.length < data.total, loadingList: false });
      })
      .catch((e) => {
        if (seq === this._seq) this.setData({ loadingList: false });
        throw e;
      });
  },
  buildMarkers() { /* Task 5 实现 */ },
  switchMode(e) { this.setData({ mode: e.currentTarget.dataset.mode }); },
  openAdd() { wx.navigateTo({ url: '/packageFootRecords/pages/record-edit/record-edit' }); },
  noop() {},
});

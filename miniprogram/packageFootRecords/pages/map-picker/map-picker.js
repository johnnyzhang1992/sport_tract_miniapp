// 自建地图选点页：/geo/search 防抖搜索 + 直接点地图 → /geo/reverse 回填地址 → eventChannel 回传
// 入口：record-edit pickBySelfMap() navigateTo（events.acceptPick 已接好）
// 字段契约（以 src/routes/geo.routes.ts 现状 + curl dev 3004 实测为准）：
//   GET /geo/reverse?lat=..&lng=..  → data:{address}（参数名是 lat/lng，非 latitude/longitude；额度耗尽降级时 address 为 ''）
//   GET /geo/search?keyword=..&latitude=..&longitude=.. → data:[{name,address,latitude,longitude}]
const api = require('../../../services/api');

const DEFAULT_CENTER = { latitude: 30.5, longitude: 114.3 };
const PIN_ICON = '/assets/icons/lucide-pin.png';

Page({
  data: {
    center: DEFAULT_CENTER,
    scale: 12,
    picked: null, // {latitude, longitude, name, address}
    markers: [],
    keyword: '',
    places: [],
    listHeight: '0rpx', // scroll-view 用 scroll-y 时必须显式高度（仅 max-height 会塌陷为 0），按条数计算、6 条封顶
    searching: false,
    searchError: '',
  },
  onLoad() {
    // 以当前位置为初始视野（拒绝授权则用默认中心，不阻塞）
    wx.getLocation({
      type: 'gcj02',
      success: (r) => this.setData({ center: { latitude: r.latitude, longitude: r.longitude } }),
    });
  },
  onUnload() {
    clearTimeout(this._t); // 离开页面时防抖定时器未触发：清理，避免卸载后 setData
  },
  onKeyword(e) {
    this.setData({ keyword: e.detail.value });
    clearTimeout(this._t);
    const kw = e.detail.value.trim();
    if (!kw) return this.showResults([]);
    this._t = setTimeout(() => this.doSearch(kw), 500); // 防抖 500ms 省额度
  },
  /** 结果列表渲染统一入口：高度 = min(条数, 6) × 单条约高 */
  showResults(items) {
    const n = Math.min(items.length, 6);
    this.setData({ places: items, listHeight: n ? n * 118 + 'rpx' : '0rpx' });
  },
  async doSearch(kw) {
    this.setData({ searching: true, searchError: '' });
    try {
      const { latitude, longitude } = this.data.center;
      const items = await api.get('/geo/search', { keyword: kw, latitude, longitude });
      this.showResults(Array.isArray(items) ? items : []);
      this.setData({ searching: false });
    } catch (e) {
      // 限流/上游失败不阻塞点选主路径
      this.setData({ searching: false, searchError: (e && e.message) || '搜索失败，可直接点选地图' });
    }
  },
  pickResult(e) {
    const p = this.data.places[Number(e.currentTarget.dataset.idx)];
    if (!p) return;
    // 选中搜索结果：图钉 + 视野移到该点（不再逆地理，结果自带名称/地址），收起下拉列表
    this.showResults([]);
    this.setPicked({ latitude: p.latitude, longitude: p.longitude, name: p.name, address: p.address }, true);
  },
  /** 直接点地图：坐标 → /geo/reverse 回填地址 */
  onMapTap(e) {
    const d = (e && e.detail) || {};
    const latitude = Number(d.latitude);
    const longitude = Number(d.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    this.setPicked({ latitude, longitude, name: '', address: '解析中…' }, false);
    api.get('/geo/reverse', { lat: latitude, lng: longitude })
      .then((data) => {
        const addr = (data && data.address) || '';
        // 上游额度耗尽/降级时 address 为空：显示"地图选点"，坐标兜底不阻塞确认
        this.setData({ 'picked.address': addr, 'picked.name': addr || '地图选点' });
      })
      .catch(() => this.setData({ 'picked.address': '', 'picked.name': '地图选点' }));
  },
  setPicked(p, recenter) {
    const patch = {
      picked: p,
      markers: [{ id: 1, latitude: p.latitude, longitude: p.longitude, iconPath: PIN_ICON, width: 28, height: 28, anchor: { x: 0.5, y: 1 } }],
    };
    if (recenter) patch.center = { latitude: p.latitude, longitude: p.longitude };
    this.setData(patch);
  },
  confirm() {
    if (!this.data.picked) return wx.showToast({ title: '请先选择地点', icon: 'none' });
    this.getOpenerEventChannel().emit('acceptPick', this.data.picked);
    wx.navigateBack();
  },
});

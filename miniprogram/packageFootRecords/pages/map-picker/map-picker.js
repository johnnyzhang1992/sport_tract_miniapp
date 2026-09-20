// 自建地图选点页：/geo/search 防抖搜索 + 直接点地图 → /geo/reverse 回填地址 → eventChannel 回传
// 入口：record-edit pickBySelfMap() navigateTo（events.acceptPick 已接好）
// 字段契约（以 src/routes/geo.routes.ts 现状 + curl dev 3004 实测为准）：
//   GET /geo/reverse?lat=..&lng=..  → data:{address}（参数名是 lat/lng，非 latitude/longitude；额度耗尽降级时 address 为 ''）
//   GET /geo/search?keyword=..&latitude=..&longitude=.. → data:[{name,address,latitude,longitude}]
const api = require('../../../services/api');

const DEFAULT_CENTER = { latitude: 30.5, longitude: 114.3 };
const PIN_ICON = '/assets/icons/lucide-pin.png';
const PARSING = '解析中…'; // 逆地理未完成时的占位，绝不能流出到保存的记录
const FALLBACK_NAME = '地图选点';

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
    this._revTok = 0; // 逆地理请求序号：只认最后一次点选的回包
    this._searchId = 0; // 搜索请求序号：只认最后一次发起的搜索的回包
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
    const value = e.detail.value;
    this.setData({ keyword: value });
    clearTimeout(this._t);
    const kw = value.trim();
    if (!kw) {
      // 输入清空：作废在途搜索（否则会回填已被删掉的关键字），并收起错误横幅/加载中
      this._searchId += 1;
      this.setData({ searching: false, searchError: '' });
      return this.showResults([]);
    }
    this._t = setTimeout(() => this.doSearch(kw), 500); // 防抖 500ms 省额度
  },
  /** 结果列表渲染统一入口：高度 = min(条数, 6) × 单条约高 */
  showResults(items) {
    const n = Math.min(items.length, 6);
    this.setData({ places: items, listHeight: n ? n * 118 + 'rpx' : '0rpx' });
  },
  async doSearch(kw) {
    const id = ++this._searchId;
    this.setData({ searching: true, searchError: '' });
    try {
      const { latitude, longitude } = this.data.center;
      const items = await api.get('/geo/search', { keyword: kw, latitude, longitude });
      if (id !== this._searchId) return; // 迟到响应：期间已发出更新的搜索/已清空输入
      this.showResults(Array.isArray(items) ? items : []);
      this.setData({ searching: false });
    } catch (e) {
      if (id !== this._searchId) return;
      // 限流/上游失败不阻塞点选主路径：旧列表必须清掉（否则点下去会选到上一次关键字的点）
      this.showResults([]);
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
    const tok = ++this._revTok;
    this.setPicked({ latitude, longitude, name: '', address: PARSING }, false);
    api.get('/geo/reverse', { lat: latitude, lng: longitude })
      .then((data) => {
        if (!this.isStillPicked(tok, latitude, longitude)) return; // 迟到响应：期间已另选他点
        const addr = (data && data.address) || '';
        // 逆地理文案只作显示名：address 留空，否则编辑页主行（name || address）与次行会双份渲染同一句；
        // 上游额度耗尽/降级时 addr 为空即显示"地图选点"，坐标兜底不阻塞确认
        this.setData({ 'picked.name': addr || FALLBACK_NAME, 'picked.address': '' });
      })
      .catch(() => {
        if (!this.isStillPicked(tok, latitude, longitude)) return;
        this.setData({ 'picked.address': '', 'picked.name': FALLBACK_NAME });
      });
  },
  /** 迟到响应守卫：序号仍是最新，且当前 picked 仍是发起该请求时的那组坐标 */
  isStillPicked(tok, latitude, longitude) {
    const p = this.data.picked;
    return tok === this._revTok && !!p && p.latitude === latitude && p.longitude === longitude;
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
    // 兜底清洗：逆地理被迟到守卫拦下/尚未回包就确认时，占位文案不能进入保存的记录。
    // 统一归一为 name:'地图选点' / address:''：
    // 只替 address 会让编辑页主行（name || address）与次行（address）双份渲染同一文案，
    // 且 name 留空会被原样存进库（列表/弹窗标题处只剩兜底字）。
    const pick = Object.assign({}, this.data.picked);
    if (pick.name === PARSING || pick.address === PARSING) {
      pick.name = FALLBACK_NAME;
      pick.address = '';
    }
    this.getOpenerEventChannel().emit('acceptPick', pick);
    wx.navigateBack();
  },
});

/**
 * 运动榜（新 tab）：全平台点亮地图 + 按运动类型/省份排行
 * - 地图：canvas 2d 直绘 GeoJSON（utils/map-draw），点亮省按轨迹数上色，点击省份弹窗下钻城市
 * - 排行：类型 chips + 省份选择，TOP10 昵称模糊（服务端处理，不可点击），底部当前用户真实排名
 */
const drawGeoMap = require('../../utils/map-draw');

const ACTIVITY_TYPES = require('../../config/index').ACTIVITY_TYPES;

// 省份名 → 行政区划代码（与足迹页一致，用于拉省份城市 GeoJSON）
const PROVINCE_TO_CODE = {
  '北京市': '110000', '天津市': '120000', '河北省': '130000', '山西省': '140000',
  '内蒙古自治区': '150000', '辽宁省': '210000', '吉林省': '220000', '黑龙江省': '230000',
  '上海市': '310000', '江苏省': '320000', '浙江省': '330000', '安徽省': '340000',
  '福建省': '350000', '江西省': '360000', '山东省': '370000', '河南省': '410000',
  '湖北省': '420000', '湖南省': '430000', '广东省': '440000', '广西壮族自治区': '450000',
  '海南省': '460000', '重庆市': '500000', '四川省': '510000', '贵州省': '520000',
  '云南省': '530000', '西藏自治区': '540000', '陕西省': '610000', '甘肃省': '620000',
  '青海省': '630000', '宁夏回族自治区': '640000', '新疆维吾尔自治区': '650000',
  '台湾省': '710000', '香港特别行政区': '810000', '澳门特别行政区': '820000',
};

/** 轨迹数 → 点亮色深浅（浅蓝 → 品牌蓝） */
function heatColor(count, max) {
  const t = Math.min(1, Math.sqrt(count / (max || 1))); // 开方：低值区分度更高
  const r = Math.round(0xcf + (0x2b - 0xcf) * t);
  const g = Math.round(0xe0 + (0x6c - 0xe0) * t);
  const b = Math.round(0xff + (0xf6 - 0xff) * t);
  return `rgb(${r},${g},${b})`;
}

// 性别 → 图标（0 未知/保密 → 锁）
const GENDER_ICONS = {
  0: '/assets/icons/gender-secret.png',
  1: '/assets/icons/gender-male.png',
  2: '/assets/icons/gender-female.png',
};

/** 本榜最佳指标：key → 展示名（顺序后端定，前端只负责文案与格式化） */
const BEST_LABELS = {
  farthest: '最长距离',
  longest: '最长时间',
  fastestKm: '最快配速',
  fastestAvg: '最快均速',
  maxClimb: '最大爬升',
};

/** 秒 → mm:ss / h:mm:ss */
function fmtDur(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s % 60)}` : `${p(m)}:${p(s % 60)}`;
}

/** 本榜最佳值格式化：key 决定单位语义（后端只回原始值：米/秒） */
function fmtBestValue(key, v) {
  if (v == null) return '';
  if (key === 'farthest') return `${(v / 1000).toFixed(2)} km`;
  if (key === 'longest') return fmtDur(v);
  if (key === 'fastestKm') {
    // 秒/公里 → 分'秒"
    const m = Math.floor(v / 60);
    const s = Math.round(v - m * 60);
    return `${m}'${String(s).padStart(2, '0')}"`;
  }
  if (key === 'fastestAvg') return `${(3600 / v).toFixed(1)} km/h`; // 秒/公里 → km/h
  if (key === 'maxClimb') return `${Math.round(v)} m`;
  return String(v);
}

/** 头像：OSS 签名 URL 优先 → 预设头像本地资源 → 昵称首字（由 WXML 兒底展示） */
function avatarOf(r) {
  return {
    avatarSrc: r.avatarUrl || (r.avatarPreset ? `/assets/avatars/${r.avatarPreset}.png` : ''),
    avatarText: (r.name || '迹')[0],
  };
}

/** 行数据装饰：性别图标 + 前三名奖牌图标 + 头像（共用 TOP10 / 本榜最佳 / 我的排名卡） */
function decorateRows(board) {
  if (!board) return board;
  const deco = (r) => ({
    ...r,
    genderIcon: GENDER_ICONS[r.gender] || GENDER_ICONS[0],
    medalIcon: r.rank <= 3 ? `/assets/icons/rank-medal-${r.rank}.png` : '',
    ...avatarOf(r),
  });
  return {
    ...board,
    top: (board.top || []).map(deco),
    me: board.me ? deco(board.me) : null,
    best: (board.best || []).map((b) => ({
      ...b,
      label: BEST_LABELS[b.key] || b.key,
      valueText: fmtBestValue(b.key, b.value),
      ...avatarOf(b),
    })),
  };
}

/** 榜单周期 */
const PERIODS = [
  { key: 'week', label: '周榜' },
  { key: 'month', label: '月榜' },
  { key: 'year', label: '年榜' },
  { key: 'all', label: '总榜' },
];

Page({
  data: {
    loggedIn: false,
    loading: true,
    // 点亮地图
    provinceCount: 0,
    cityCount: 0,
    totalUsers: 0,
    // 排行
    periods: PERIODS,
    periodIndex: 0, // 默认周榜
    types: ACTIVITY_TYPES,
    typeIndex: 0, // 默认散步（config 顺序：0散步 1跑步）
    provinceOptions: ['全国'],
    provinceIndex: 0,
    board: null, // { players, top, me }
    // 省份弹窗
    provinceModal: false,
    provinceModalName: '',
    provinceCities: [],
    noop() {},
  },

  onLoad() {
    this._chinaMap = null;
    this._provinceMaps = {};
    this.refresh();
  },

  onShow() {
    // tab 切回时静默刷新排行（保留用户当前选择）
    if (this._loaded) this.refresh(true);
  },

  async refresh(silent = false) {
    const app = getApp();
    if (app.hasSession() && !app.globalData.loggedIn) {
      try { await app.login(); } catch (e) { console.warn('静默登录失败', e); }
    }
    const loggedIn = !!app.globalData.loggedIn;
    this.setData({ loggedIn, loading: !silent && loggedIn });
    if (!loggedIn) return;

    try {
      const api = app.globalData.api;
      const [regions, boardRaw] = await Promise.all([
        api.get('/stats/leaderboard-regions'),
        api.get(`/stats/leaderboard?type=${this.curType()}&province=${encodeURIComponent(this.curProvince())}&period=${this.curPeriod()}`),
      ]);
      const board = decorateRows(boardRaw);
      this._regions = regions;
      const provinceOptions = ['全国', ...regions.provinces.map((p) => p.name)];
      this.setData({
        provinceCount: regions.provinces.length,
        cityCount: regions.cities.length,
        totalUsers: regions.totalUsers,
        provinceOptions,
        board,
        loading: false,
      });
      this._loaded = true;
      // 中国地图数据（省界 GeoJSON）加载后绘制
      const geo = await this.ensureChinaMap();
      if (geo && !this.data.provinceModal) this.drawChinaMap();
    } catch (e) {
      console.error('[leaderboard] 加载失败', e);
      this.setData({ loading: false });
      if (!silent) wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  curType() {
    return this.data.types[this.data.typeIndex].type;
  },
  curProvince() {
    return this.data.provinceOptions[this.data.provinceIndex] || '全国';
  },
  curPeriod() {
    return this.data.periods[this.data.periodIndex].key;
  },
  periodLabel() {
    return this.data.periods[this.data.periodIndex].label;
  },

  async ensureChinaMap() {
    if (this._chinaMap) return this._chinaMap;
    try {
      this._chinaMap = await getApp().globalData.api.get('/geo/china-map');
      return this._chinaMap;
    } catch (e) {
      console.error('加载中国地图失败', e);
      return null;
    }
  },

  /** 主图：全国点亮状态（所有用户） */
  drawChinaMap() {
    return new Promise((resolve) => {
      this.createSelectorQuery()
        .select('#chinaMap')
        .fields({ node: true, size: true, rect: true })
        .exec((res) => {
          if (!res || !res[0] || !res[0].node || !this._regions || !this._chinaMap) {
            resolve(null);
            return;
          }
          const canvas = res[0].node;
          const dpr = (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2) || 2;
          canvas.width = res[0].width * dpr;
          canvas.height = res[0].height * dpr;
          const ctx = canvas.getContext('2d');
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

          const byName = {};
          this._regions.provinces.forEach((p) => { byName[p.name] = p.count; });
          const max = Math.max(...this._regions.provinces.map((p) => p.count), 1);
          const tester = drawGeoMap(ctx, res[0].width, res[0].height, {
            geojson: this._chinaMap,
            valueOf: (name) => byName[name],
            colorFor: (name, v) => heatColor(v, max),
          });
          this._chinaRect = { left: res[0].left, top: res[0].top };
          this._chinaTester = tester;
          resolve(tester);
        });
    });
  },

  onChinaMapTap(e) {
    if (!this._chinaTester || !this._chinaRect) return;
    const t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    // tap 的 clientX/Y 是视口坐标，减去画布视口位置才是画布内坐标
    const name = this._chinaTester.hitTest(t.clientX - this._chinaRect.left, t.clientY - this._chinaRect.top);
    if (name) this.openProvinceModal(name);
  },

  /** 省份弹窗：城市地图（全平台口径）+ 城市点亮列表 */
  async openProvinceModal(name) {
    const code = PROVINCE_TO_CODE[name];
    if (!code) return;
    const cities = (this._regions ? this._regions.cities : []).filter((c) => c.province === name);
    this._modalProvince = name;
    this.setData({ provinceModal: true, provinceModalName: name, provinceCities: cities }, async () => {
      try {
        if (!this._provinceMaps[code]) {
          this._provinceMaps[code] = await getApp().globalData.api.get(`/geo/province-map?adcode=${code}`);
        }
        const geo = this._provinceMaps[code];
        await new Promise((resolve) => {
          this.createSelectorQuery()
            .select('#provMap')
            .fields({ node: true, size: true })
            .exec((res) => {
              if (!res || !res[0] || !res[0].node) { resolve(); return; }
              const canvas = res[0].node;
              const dpr = (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2) || 2;
              canvas.width = res[0].width * dpr;
              canvas.height = res[0].height * dpr;
              const ctx = canvas.getContext('2d');
              ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
              const byName = {};
              cities.forEach((c) => { byName[c.name] = c.count; });
              const max = Math.max(...cities.map((c) => c.count), 1);
              drawGeoMap(ctx, res[0].width, res[0].height, {
                geojson: geo,
                valueOf: (n) => byName[n],
                colorFor: (n, v) => heatColor(v, max),
                unlitColor: '#ececec',
              });
              resolve();
            });
        });
      } catch (e) {
        console.error('加载省份地图失败', e);
        wx.showToast({ title: '地图加载失败', icon: 'none' });
      }
    });
  },

  closeProvinceModal() {
    this.setData({ provinceModal: false });
  },

  /** 弹窗 → 用该省视角看排行 */
  rankThisProvince() {
    const name = this.data.provinceModalName;
    const idx = this.data.provinceOptions.indexOf(name);
    this.setData({
      provinceModal: false,
      provinceIndex: idx >= 0 ? idx : 0,
    });
    this.fetchBoard();
    wx.pageScrollTo({ selector: '.rank-card', duration: 300 });
  },

  onPeriodTap(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (index === this.data.periodIndex) return;
    this.setData({ periodIndex: index });
    this.fetchBoard();
  },

  onTypeTap(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (index === this.data.typeIndex) return;
    this.setData({ typeIndex: index });
    this.fetchBoard();
  },

  onProvinceChange(e) {
    this.setData({ provinceIndex: Number(e.detail.value) });
    this.fetchBoard();
  },

  async fetchBoard() {
    try {
      const board = decorateRows(
        await getApp().globalData.api.get(
          `/stats/leaderboard?type=${this.curType()}&province=${encodeURIComponent(this.curProvince())}&period=${this.curPeriod()}`,
        ),
      );
      this.setData({ board });
    } catch (e) {
      console.error('[leaderboard] 排行加载失败', e);
      wx.showToast({ title: '排行加载失败', icon: 'none' });
    }
  },

  /** 游客登录（页面内引导） */
  async guestLogin() {
    try {
      await getApp().login();
      this.refresh();
    } catch (e) {
      wx.showToast({ title: '登录失败', icon: 'none' });
    }
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh());
  },

  onShareAppMessage() {
    const n = this.data.totalUsers || 0;
    return {
      title: n > 0 ? `运动榜 · 已有${n}位迹路者点亮地图` : '运动榜',
      path: '/pages/leaderboard/leaderboard',
    };
  },
});

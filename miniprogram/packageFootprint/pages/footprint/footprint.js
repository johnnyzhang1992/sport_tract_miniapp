const echarts = require('../../components/ec-canvas/echarts');

// 省份名称 → 行政区划代码（与 web 后台 FootprintMap 一致）
const PROVINCE_TO_CODE = {
  '北京市': '110000',
  '天津市': '120000',
  '河北省': '130000',
  '山西省': '140000',
  '内蒙古自治区': '150000',
  '辽宁省': '210000',
  '吉林省': '220000',
  '黑龙江省': '230000',
  '上海市': '310000',
  '江苏省': '320000',
  '浙江省': '330000',
  '安徽省': '340000',
  '福建省': '350000',
  '江西省': '360000',
  '山东省': '370000',
  '河南省': '410000',
  '湖北省': '420000',
  '湖南省': '430000',
  '广东省': '440000',
  '广西壮族自治区': '450000',
  '海南省': '460000',
  '重庆市': '500000',
  '四川省': '510000',
  '贵州省': '520000',
  '云南省': '530000',
  '西藏自治区': '540000',
  '陕西省': '610000',
  '甘肃省': '620000',
  '青海省': '630000',
  '宁夏回族自治区': '640000',
  '新疆维吾尔自治区': '650000',
  '台湾省': '710000',
  '香港特别行政区': '810000',
  '澳门特别行政区': '820000',
};


/** 地图配置：点亮省高亮（visualMap 按 value 深浅），未点亮灰 */
function getMapOption(data) {
  return {
    // 注意：不能设 backgroundColor（不透明画布会盖住页面上的按钮）；导出时临时铺白底，见 exportChartImage
    tooltip: {
      trigger: 'item',
      formatter: (p) => (p.value ? `${p.name}：${p.value} 次` : p.name),
    },
    visualMap: {
      min: 0,
      max: 10,
      seriesIndex: 0,
      show: false,
      inRange: { color: ['#cfe0ff', '#2b6cf6'] },
    },
    series: [
      {
        type: 'map',
        map: 'china',
        roam: true, // 支持双指缩放 + 拖动
        layoutCenter: ['50%', '52%'],
        layoutSize: '108%', // 适中放大，顶部（黑龙江）不截
        label: { show: false }, // 隐藏省份名称（文字挤）
        itemStyle: {
          areaColor: '#eef1f5',
          borderColor: '#c8d0dc', // 浅灰蓝边框（南海诸岛框可见）
          borderWidth: 1,
        },
        emphasis: {
          label: { show: true },
          itemStyle: { areaColor: '#bcd4ff' },
        },
        data,
      },
    ],
  };
}

/**
 * 省级地图配置：已点亮城市按 count 深浅，未点亮灰色（参考 web 后台 FootprintMap）
 * @param {string} mapName 已 registerMap 的省份地图名
 * @param {Array<{name, province, count}>} provCities 该省点亮城市
 * @param {Array} features 省份 GeoJSON 的 features（含全部城市边界）
 */
function getProvinceOption(mapName, provCities, features) {
  const litByName = {};
  provCities.forEach((c) => { litByName[c.name] = c.count; });

  const data = [];
  const seen = new Set();
  (features || []).forEach((f) => {
    const cityName = f.properties && f.properties.name;
    if (!cityName || seen.has(cityName)) return;
    seen.add(cityName);
    const count = litByName[cityName];
    data.push({ name: cityName, value: count > 0 ? count : undefined });
  });
  // 补充点亮城市中有、但 GeoJSON 中缺失的城市
  provCities.forEach((c) => {
    if (!seen.has(c.name)) {
      seen.add(c.name);
      data.push({ name: c.name, value: c.count });
    }
  });

  const maxVal = Math.max(...provCities.map((c) => c.count), 1);
  return {
    // 注意：不能设 backgroundColor（不透明画布会盖住页面上的按钮）；导出时临时铺白底，见 exportChartImage
    tooltip: {
      trigger: 'item',
      formatter: (p) => (p.value ? `${p.name}：${p.value} 次` : p.name),
    },
    visualMap: {
      min: 0,
      max: maxVal,
      seriesIndex: 0,
      show: false,
      inRange: { color: ['#e0f3f8', '#abd9e9', '#74add1', '#4575b4', '#313695'] },
    },
    series: [
      {
        type: 'map',
        map: mapName,
        roam: true,
        label: { show: true, fontSize: 8, color: '#333' },
        emphasis: {
          label: { show: true, fontSize: 10, color: '#fff' },
          itemStyle: { areaColor: '#ffd700' },
        },
        itemStyle: { areaColor: '#f0f0f0', borderColor: '#ccc' },
        data: data.map((d) => ({
          ...d,
          itemStyle: d.value ? undefined : { areaColor: '#e8e8e8' },
          label: { color: d.value ? '#fff' : '#666' },
        })),
      },
    ],
  };
}

Page({
  data: {
    provinceCount: 0,
    cityCount: 0,
    cities: [],
    loading: false,
    ec: {},
    fsEc: {},
    fullscreen: false,
    provinceModal: false,
    provinceModalName: '',
    provEc: {},
    sharePreview: false,
    shareImageSrc: '',
  },

  onLoad() {
    this.fetch();
  },

  /** 缩放：+ 放大 / - 缩小（setOption 更新 map zoom，方向可靠） */
  zoomIn() {
    this.zoomMap(1.3);
  },

  zoomOut() {
    this.zoomMap(1 / 1.3);
  },

  zoomMap(factor) {
    const chart = this.data.fullscreen ? this.fsChart : this.chart;
    if (!chart || typeof chart.setOption !== 'function') return;
    const opt = chart.getOption();
    const cur = (opt.series && opt.series[0] && opt.series[0].zoom) || 1;
    const next = Math.max(0.5, Math.min(8, cur * factor));
    chart.setOption({ series: [{ zoom: next }] });
  },

  /** 全屏展示地图 */
  openFullscreen() {
    this.setData({ fullscreen: true }, () => {
      // setData 是异步的：回调时遮罩+fsMap 组件已渲染完成，此时才能取到组件并初始化
      const comp = this.selectComponent('#fsMap');
      this._fsComp = comp;
      if (comp && comp.init) {
        comp.init((canvas, width, height, dpr) => {
          const chart = echarts.init(canvas, null, { width, height, devicePixelRatio: dpr });
          canvas.setChart(chart);
          if (this._chinaMap) {
            echarts.registerMap('china', this._chinaMap);
            chart.setOption(getMapOption(this._mapData || []));
          }
          chart.on('click', (p) => this.onMapClick(p));
          this.fsChart = chart;
          return chart; // ec-canvas 内部 this.chart = callback(...)，必须返回 chart 才能转发触摸事件
        });
      }
    });
  },

  closeFullscreen() {
    this.setData({ fullscreen: false });
    this.fsChart = null; // 组件（wx:if）销毁重建，下次打开需重新初始化
  },

  /** 主图/全屏图点击省份 → 打开省级下钻弹窗 */
  onMapClick(params) {
    if (!params || params.componentType !== 'series' || params.seriesType !== 'map') return;
    const name = params.name;
    const code = PROVINCE_TO_CODE[name];
    if (!code) {
      console.warn(`未找到省份 ${name} 的行政区划代码`);
      return;
    }
    this.openProvinceMap(name, code);
  },

  /** 打开省级地图弹窗：展示该省各城市点亮情况（参考 web 后台） */
  async openProvinceMap(name, code) {
    // 无点亮城市也允许打开：全部城市灰显
    const provCities = (this.data.cities || []).filter((c) => c.province === name);
    this._provinceName = name;
    this.setData({ provinceModal: true, provinceModalName: name }, async () => {
      try {
        // 省份 GeoJSON（放后端，按需拉取并缓存）
        if (!this._provinceMaps) this._provinceMaps = {};
        if (!this._provinceMaps[code]) {
          const map = await getApp().globalData.api.get(`/geo/province-map?adcode=${code}`);
          this._provinceMaps[code] = map;
        }
        const mapKey = `province-${code}`;
        echarts.registerMap(mapKey, this._provinceMaps[code]);

        const comp = this.selectComponent('#provMap');
        this._provComp = comp;
        if (comp && comp.init) {
          comp.init((canvas, width, height, dpr) => {
            const chart = echarts.init(canvas, null, { width, height, devicePixelRatio: dpr });
            canvas.setChart(chart);
            const features = this._provinceMaps[code].features || [];
            chart.setOption(getProvinceOption(mapKey, provCities, features));
            this.provChart = chart;
            return chart;
          });
        }
      } catch (e) {
        console.error('加载省份地图失败', e);
        wx.showToast({ title: '加载失败', icon: 'none' });
        this.setData({ provinceModal: false });
      }
    });
  },

  closeProvinceMap() {
    this.setData({ provinceModal: false });
    this.provChart = null; // 组件（wx:if）销毁重建，下次打开需重新初始化
  },

  /** 弹窗入口 → 跳轨迹列表看该省轨迹（tab 页不带参，走 globalData 传递） */
  viewProvinceTracks() {
    const name = this.data.provinceModalName;
    if (!name) return;
    this.setData({ provinceModal: false });
    this.provChart = null;
    getApp().globalData.pendingTracksProvince = name;
    wx.switchTab({ url: '/pages/tracks/tracks' });
  },

  noop() {},

  /** 分享：生成当前地图图片 → 预览弹窗（支持保存到相册） */
  openSharePreview() {
    const comp = this.data.fullscreen ? this._fsComp : this._mapComp;
    const statsText = `点亮省份 ${this.data.provinceCount || 0} 个 · 轨迹 ${this._trackCount || 0} 条`;
    this.exportChartImage(comp, {
      statsText,
      // 导出图临时布局：地图下移留出顶部标题空间（中国地图专用），导出后恢复
      layoutCenter: ['50%', '62%'],
      layoutSize: '96%',
      restoreLayout: { layoutCenter: ['50%', '52%'], layoutSize: '108%' },
    });
  },

  /** 省份弹窗内保存：导出省份地图图片 */
  saveProvinceImage() {
    this.exportChartImage(this._provComp);
  },

  /**
   * 导出地图图片：canvas 2d 节点 → wx.canvasToTempFilePath → 预览弹窗
   * 不用 chart.getDataURL()：小程序环境 zrender 的 drawImage 类型校验会失败
   * 画布平时保持透明（不透明画布会盖住页面按钮）；导出时临时铺白底，截完恢复
   * @param {object} opts 可选：{ statsText, layoutCenter, layoutSize, restoreLayout } —— 中国地图分享图加统计标题
   */
  exportChartImage(comp, opts = {}) {
    if (!comp || !comp.canvasNode) {
      wx.showToast({ title: '地图尚未就绪', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '生成中…' });
    const chart = comp.chart || null;
    if (chart) {
      const exportOpt = { backgroundColor: '#ffffff' };
      if (opts.statsText) {
        exportOpt.series = [{ layoutCenter: opts.layoutCenter, layoutSize: opts.layoutSize }];
      }
      chart.setOption(exportOpt);
      // setOption 走 zrender 异步 rAF；不 flush 的话 canvasToTempFilePath 可能抓到旧帧
      chart.getZr().flush();
      if (opts.statsText) {
        // 自定义 echarts 构建未打包 title/graphic 组件，统计标题用原生 2d context 绘制
        this._drawExportTitle(comp, opts.statsText);
      }
    }
    setTimeout(() => {
      wx.canvasToTempFilePath({
        canvas: comp.canvasNode,
        fileType: 'png',
        success: (res) => {
          this._shareFilePath = res.tempFilePath;
          this.setData({ sharePreview: true, shareImageSrc: res.tempFilePath });
        },
        fail: (e) => {
          console.error('导出图片失败', e);
          wx.showToast({ title: '生成失败', icon: 'none' });
        },
        complete: () => {
          if (chart) {
            const restoreOpt = { backgroundColor: 'transparent' };
            if (opts.statsText) {
              restoreOpt.series = [opts.restoreLayout];
            }
            chart.setOption(restoreOpt);
            chart.getZr().flush();
          }
          wx.hideLoading();
        },
      });
    }, 250);
  },

  /** 统计标题：直接画在导出画布上（原生 ctx，物理像素坐标），后续 restore 重绘会清掉 */
  _drawExportTitle(comp, text) {
    try {
      const node = comp.canvasNode;
      const ctx = node.getContext('2d');
      const dpr = (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio) || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.font = `bold ${Math.round(16 * dpr)}px sans-serif`;
      ctx.fillStyle = '#1f2329';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(text, node.width / 2, Math.round(14 * dpr));
    } catch (e) {
      console.error('绘制导出标题失败', e);
    }
  },

  closeSharePreview() {
    this.setData({ sharePreview: false });
  },

  /** 保存预览图到相册（首次需授权，拒绝后引导去设置） */
  saveShareImage() {
    if (!this._shareFilePath) return;
    wx.saveImageToPhotosAlbum({
      filePath: this._shareFilePath,
      success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        if (msg.includes('auth') || msg.includes('deny') || msg.includes('authorize')) {
          wx.showModal({
            title: '需要相册权限',
            content: '保存图片需要相册权限，是否前往设置开启？',
            confirmText: '去设置',
            success: (r) => {
              if (r.confirm) wx.openSetting();
            },
          });
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' });
        }
      },
    });
  },

  onReady() {
    // 初始化 echarts 地图（canvas 就绪后）
    const comp = this.selectComponent('#footprintMap');
    this._mapComp = comp;
    if (comp && comp.init) {
      comp.init((canvas, width, height, dpr) => {
        const chart = echarts.init(canvas, null, { width, height, devicePixelRatio: dpr });
        canvas.setChart(chart);
        if (this._chinaMap) {
          echarts.registerMap('china', this._chinaMap);
          chart.setOption(getMapOption(this._mapData || []));
        }
        chart.on('click', (p) => this.onMapClick(p));
        this.chart = chart;
        return chart; // ec-canvas 内部 this.chart = callback(...)，必须返回 chart 才能转发触摸事件
      });
    }
  },

  async fetch() {
    const app = getApp();
    // 已注册用户（本地有 token）静默恢复登录；游客不自动登录
    if (app.hasSession() && !app.globalData.loggedIn) {
      try {
        await app.login();
      } catch (e) {
        console.warn('静默登录失败', e);
      }
    }
    if (!app.globalData.loggedIn) return;
    this.setData({ loading: true });
    try {
      // 省界地图数据（放后端，按需拉取）
      if (!this._chinaMap) {
        try {
          const map = await getApp().globalData.api.get('/geo/china-map');
          this._chinaMap = map;
          echarts.registerMap('china', map);
        } catch (e) {
          console.error('加载地图数据失败', e);
        }
      }
      const [res, ov] = await Promise.all([
        getApp().globalData.api.get('/stats/footprint'),
        getApp().globalData.api.get('/stats/overview').catch(() => null),
      ]);
      // 累计轨迹数（分享图统计用）
      this._trackCount = ov && ov.total ? ov.total.count : 0;
      this.setData({
        provinceCount: res.provinceCount,
        cityCount: res.cityCount,
        cities: res.cities || [],
      });
      // 更新地图高亮
      const mapData = (res.provinces || []).map((p) => ({ name: p.name, value: p.count }));
      this._mapData = mapData;
      if (this.chart) {
        this.chart.setOption(getMapOption(mapData));
      }
      if (this.fsChart) {
        this.fsChart.setOption(getMapOption(mapData));
      }
    } catch (e) {
      console.error('加载足迹失败', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  /** 分享给朋友（带已点亮省数） */
  onShareAppMessage() {
    const provCnt = this.data.provinceCount || 0;
    return {
      title: provCnt > 0 ? `我的点亮地图 · 已点亮${provCnt}省` : '我的点亮地图',
      path: '/packageFootprint/pages/footprint/footprint',
    };
  },

  /** 分享到朋友圈 */
  onShareTimeline() {
    const provCnt = this.data.provinceCount || 0;
    return { title: provCnt > 0 ? `我的点亮地图 · 已点亮${provCnt}省` : '我的点亮地图' };
  },
});

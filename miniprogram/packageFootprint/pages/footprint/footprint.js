const echarts = require('../../components/ec-canvas/echarts');


/** 地图配置：点亮省高亮（visualMap 按 value 深浅），未点亮灰 */
function getMapOption(data) {
  return {
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

Page({
  data: {
    provinceCount: 0,
    cityCount: 0,
    cities: [],
    loading: false,
    ec: {},
    fsEc: {},
    fullscreen: false,
  },

  onLoad() {
    this.fetch();
  },

  /** 缩放：+ 放大 / - 缩小（通过 mousewheel 事件驱动 echarts roam） */
  zoomIn() {
    this.zoomMap(10);
  },

  zoomOut() {
    this.zoomMap(-10);
  },

  zoomMap(delta) {
    const chart = this.data.fullscreen ? this.fsChart : this.chart;
    if (!chart || typeof chart.getZr !== 'function') return;
    const zr = chart.getZr();
    if (!zr || !zr.handler || typeof zr.handler.dispatch !== 'function') return;
    const w = chart.getWidth() || 300;
    const h = chart.getHeight() || 300;
    zr.handler.dispatch('mousewheel', {
      zrX: w / 2,
      zrY: h / 2,
      wheelDelta: delta,
      preventDefault: () => {},
      stopImmediatePropagation: () => {},
      stopPropagation: () => {},
    });
  },

  /** 全屏展示地图 */
  openFullscreen() {
    this.setData({ fullscreen: true }, () => {
      // setData 是异步的：回调时遮罩+fsMap 组件已渲染完成，此时才能取到组件并初始化
      const comp = this.selectComponent('#fsMap');
      if (comp && comp.init) {
        comp.init((canvas, width, height, dpr) => {
          const chart = echarts.init(canvas, null, { width, height, devicePixelRatio: dpr });
          canvas.setChart(chart);
          if (this._chinaMap) {
            echarts.registerMap('china', this._chinaMap);
            chart.setOption(getMapOption(this._mapData || []));
          }
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

  onReady() {
    // 初始化 echarts 地图（canvas 就绪后）
    const comp = this.selectComponent('#footprintMap');
    if (comp && comp.init) {
      comp.init((canvas, width, height, dpr) => {
        const chart = echarts.init(canvas, null, { width, height, devicePixelRatio: dpr });
        canvas.setChart(chart);
        if (this._chinaMap) {
          echarts.registerMap('china', this._chinaMap);
          chart.setOption(getMapOption(this._mapData || []));
        }
        this.chart = chart;
        return chart; // ec-canvas 内部 this.chart = callback(...)，必须返回 chart 才能转发触摸事件
      });
    }
  },

  async fetch() {
    const app = getApp();
    if (!app.globalData.loggedIn) {
      try {
        await app.login();
      } catch (e) {
        wx.showToast({ title: '登录失败', icon: 'none' });
        return;
      }
    }
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
      const res = await getApp().globalData.api.get('/stats/footprint');
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
});

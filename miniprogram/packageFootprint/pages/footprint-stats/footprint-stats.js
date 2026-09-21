// 足迹统计页（地图页左上「统计」入口进）：数据概况（总足迹/省份/城市）+ 周期筛选（月/年/全部）+ 中国点亮地图
// 口径说明：本页统计的是「足迹记录」（/footprint-records/stats），与点亮地图页的运动轨迹口径（/stats/footprint）独立
const echarts = require('../../components/ec-canvas/echarts');
const loading = require('../../../utils/loading');
const mapImage = require('../../utils/map-image.js');
const mapZoom = require('../../utils/map-zoom.js');
// 周期换算与列表页共用（utils 在主包，分包页可 require 主包资源）
const { RANGES, PICKER_COUNT, periodRange, periodLabelOf } = require('../../../utils/footprint-period.js');

/** 地图配置：点亮省高亮（visualMap 按 count 深浅），未点亮灰（对齐点亮地图页，仅去掉下钻） */
function getMapOption(data) {
  const maxVal = Math.max(...data.map((d) => Number(d.value) || 0), 1);
  return {
    // 注意：不能设 backgroundColor（不透明画布会盖住页面上的按钮）
    tooltip: {
      trigger: 'item',
      formatter: (p) => (p.value ? `${p.name}：${p.value} 个足迹` : p.name),
    },
    visualMap: {
      min: 0,
      max: maxVal,
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
    ranges: RANGES,
    activeRange: 'month',
    periodOffset: 0, // 往前的周期数（0=当前月/年）
    periodLabel: '',
    canGoNext: false,
    total: 0,
    provinceCount: 0,
    cityCount: 0,
    loaded: false, // 首次响应落地前概况显示「—」，避免先闪一帧 0
    loading: true,
    error: '',
    ec: {},
    fullscreen: false,
    fsEc: {},
    showPeriodPicker: false,
    periodOptions: [], // [{offset, label, compact, selected}]
    pickerScrollInto: '',
    sharePreview: false,
    shareImageSrc: '',
  },

  onLoad() {
    this.applyPeriod();
    this.fetch();
  },

  onReady() {
    const comp = this.selectComponent('#litMap');
    this._mapComp = comp;
    if (comp && comp.init) {
      comp.init((canvas, width, height, dpr) => {
        const chart = echarts.init(canvas, null, { width, height, devicePixelRatio: dpr });
        canvas.setChart(chart);
        if (this._chinaMap) {
          echarts.registerMap('china', this._chinaMap);
          chart.setOption(getMapOption(this._provinceData || []));
        }
        this.chart = chart;
        return chart; // ec-canvas 内部 this.chart = callback(...)，必须返回 chart 才能转发触摸事件
      });
    }
  },

  onRangeChange(e) {
    const value = e.currentTarget.dataset.value;
    if (value === this.data.activeRange) return;
    this.setData({ activeRange: value, periodOffset: 0 });
    this.applyPeriod();
    this.fetch();
  },

  /** 翻到上一周期（更早） */
  onPrevPeriod() {
    this.setData({ periodOffset: this.data.periodOffset + 1 });
    this.applyPeriod();
    this.fetch();
  },

  /** 翻回下一周期（到当前周期后不可再翻） */
  onNextPeriod() {
    if (this.data.periodOffset <= 0) return;
    this.setData({ periodOffset: this.data.periodOffset - 1 });
    this.applyPeriod();
    this.fetch();
  },

  /** 根据当前 tab + 偏移量计算周期区间与文案（"全部"无周期） */
  applyPeriod() {
    const { activeRange, periodOffset } = this.data;
    if (activeRange === 'all') {
      this._period = null;
      this.setData({ periodLabel: '', canGoNext: false });
      return;
    }
    const p = periodRange(activeRange, periodOffset);
    this._period = p;
    this.setData({ periodLabel: periodLabelOf(activeRange, p), canGoNext: periodOffset > 0 });
  },

  /** 打开周期选择弹窗：按当前粒度生成最近 N 个周期选项 */
  onTapPeriodLabel() {
    const { activeRange, periodOffset } = this.data;
    if (activeRange === 'all') return;
    const count = PICKER_COUNT[activeRange] || 12;
    const options = [];
    for (let offset = 0; offset < count; offset++) {
      const p = periodRange(activeRange, offset);
      const label = periodLabelOf(activeRange, p);
      options.push({ offset, label, compact: label.length > 12, selected: offset === periodOffset });
    }
    this.setData({ showPeriodPicker: true, periodOptions: options, pickerScrollInto: '' });
    wx.nextTick(() => {
      this.setData({ pickerScrollInto: `period-${this.data.periodOffset}` });
    });
  },
  onClosePeriodPicker() { this.setData({ showPeriodPicker: false }); },
  /** 点击弹窗选项：直接切换周期 */
  onSelectPeriod(e) {
    const offset = Number(e.currentTarget.dataset.offset);
    this.setData({ showPeriodPicker: false });
    if (offset === this.data.periodOffset) return;
    this.setData({ periodOffset: offset });
    this.applyPeriod();
    this.fetch();
  },
  /** 阻止弹窗内容点击冒泡到遮罩 */
  noop() {},

  /* ------------------------------ 地图缩放 / 全屏 ------------------------------ */

  /** 缩放：+ 放大 / - 缩小（全屏时作用于全屏图） */
  zoomIn() {
    this.zoomMap(mapZoom.ZOOM_FACTOR);
  },

  zoomOut() {
    this.zoomMap(1 / mapZoom.ZOOM_FACTOR);
  },

  zoomMap(factor) {
    mapZoom.zoomChart(this.data.fullscreen ? this.fsChart : this.chart, factor);
  },

  /** 全屏展示地图（与足迹页同款：另起一个 ec-canvas，关闭即销毁重建） */
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
            chart.setOption(getMapOption(this._provinceData || []));
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

  /* ------------------------------ 分享导出图片 ------------------------------ */

  /** 分享图顶部统计行：周期 · 足迹 · 省份 · 城市 */
  buildShareText() {
    const { activeRange, periodLabel, total, provinceCount, cityCount } = this.data;
    const period = activeRange === 'all' ? '全部时间' : periodLabel;
    return `${period} · 足迹 ${total} · 省份 ${provinceCount} · 城市 ${cityCount}`;
  },

  /** 生成分享图：地图临时铺白底 + 顶部统计行 → 预览弹窗（截完恢复透明与原布局） */
  openSharePreview() {
    if (!this.data.loaded) {
      wx.showToast({ title: '还没有数据可分享', icon: 'none' });
      return;
    }
    loading.show('生成中…');
    mapImage
      .exportChartImage(this._mapComp, {
        statsText: this.buildShareText(),
        layoutCenter: ['50%', '62%'], // 地图下移，给顶部统计行留位
        layoutSize: '96%',
        restoreLayout: { layoutCenter: ['50%', '52%'], layoutSize: '108%' },
      })
      .then((path) => {
        this._shareFilePath = path;
        this.setData({ sharePreview: true, shareImageSrc: path });
      })
      .catch((e) => {
        console.error('导出图片失败', e);
        wx.showToast({ title: (e && e.message) || '生成失败', icon: 'none' });
      })
      .finally(() => loading.hide());
  },

  closeSharePreview() { this.setData({ sharePreview: false }); },

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

  /** 转发标题：带省市数（数据未到时不报数） */
  shareTitle() {
    const { total, provinceCount, cityCount } = this.data;
    return total ? `我的足迹统计 · ${provinceCount} 省 ${cityCount} 城` : '我的足迹统计';
  },

  /** 分享给朋友（封面用刚生成的分享图） */
  onShareAppMessage() {
    return {
      title: this.shareTitle(),
      path: '/packageFootprint/pages/footprint-stats/footprint-stats',
      imageUrl: this._shareFilePath || '',
    };
  },

  /** 分享到朋友圈 */
  onShareTimeline() {
    return { title: this.shareTitle(), imageUrl: this._shareFilePath || '' };
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
    // 请求序号守卫：快速连续翻页时丢弃过期响应，避免旧数据覆盖新数据
    const seq = (this._fetchSeq = (this._fetchSeq || 0) + 1);
    // 保留旧数据直到新数据到达（避免整页闪空），仅切换 loading 态
    this.setData({ loading: true });
    try {
      // 省界地图数据（放后端，按需拉取并缓存）
      if (!this._chinaMap) {
        try {
          this._chinaMap = await app.globalData.api.get('/geo/china-map');
          echarts.registerMap('china', this._chinaMap);
        } catch (e) {
          console.error('加载地图数据失败', e);
        }
      }
      const p = this._period;
      const qs = p ? `?from=${p.from}&to=${p.to}` : '';
      const res = await app.globalData.api.get(`/footprint-records/stats${qs}`);
      if (seq !== this._fetchSeq) return;
      const provinceData = (res.provinces || []).map((x) => ({ name: x.name, value: x.count }));
      this._provinceData = provinceData;
      this.setData({
        total: res.total || 0,
        provinceCount: res.provinceCount || 0,
        cityCount: res.cityCount || 0,
        loaded: true,
        loading: false,
        error: '',
      });
      if (this.chart) this.chart.setOption(getMapOption(provinceData));
      // 全屏图也同步刷新（进全屏后仍有在途请求落地时，不至于停在旧数据）
      if (this.fsChart) this.fsChart.setOption(getMapOption(provinceData));
    } catch (e) {
      if (seq !== this._fetchSeq) return;
      console.error('加载足迹统计失败', e);
      this.setData({ loading: false, error: (e && e.message) || '加载失败' });
    }
  },
});

// 足迹统计页（地图页左上「统计」入口进）：数据概况（总足迹/省份/城市）+ 周期筛选（月/年/全部）+ 中国点亮地图
// 口径说明：本页统计的是「足迹记录」（/footprint-records/stats），与点亮地图页的运动轨迹口径（/stats/footprint）独立
const echarts = require('../../components/ec-canvas/echarts');

const RANGES = [
  { value: 'month', label: '月' },
  { value: 'year', label: '年' },
  { value: 'all', label: '全部' },
];

/** 周期选择弹窗：每个粒度展示最近 N 个周期（对齐运动报告页） */
const PICKER_COUNT = { month: 12, year: 5 };

const pad = (n) => String(n).padStart(2, '0');
/** Date → 'YYYY-MM-DD'（本地时区；接口按字符串 $gte/$lt 比对 visitDate） */
const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 月/年周期区间 [from, to)（自然月/自然年），offset 为往前的周期数（0=当前周期） */
function periodRange(range, offset) {
  const now = new Date();
  if (range === 'month') {
    return {
      from: dateStr(new Date(now.getFullYear(), now.getMonth() - offset, 1)),
      to: dateStr(new Date(now.getFullYear(), now.getMonth() - offset + 1, 1)),
    };
  }
  return {
    from: dateStr(new Date(now.getFullYear() - offset, 0, 1)),
    to: dateStr(new Date(now.getFullYear() - offset + 1, 0, 1)),
  };
}

/** 周期文案：月 → "2026年9月"，年 → "2026年"（手工拆串，避开 new Date('YYYY-MM-DD') 的 UTC 解析） */
function periodLabelOf(range, p) {
  const [y, m] = p.from.split('-').map(Number);
  return range === 'month' ? `${y}年${m}月` : `${y}年`;
}

/** 地图配置：点亮省高亮（visualMap 按 count 深浅），未点亮灰（对齐点亮地图页，仅去掉分享/全屏/下钻） */
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
    showPeriodPicker: false,
    periodOptions: [], // [{offset, label, compact, selected}]
    pickerScrollInto: '',
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
    } catch (e) {
      if (seq !== this._fetchSeq) return;
      console.error('加载足迹统计失败', e);
      this.setData({ loading: false, error: (e && e.message) || '加载失败' });
    }
  },
});

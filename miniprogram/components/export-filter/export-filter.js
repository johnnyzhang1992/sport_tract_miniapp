/** 导出筛选器：时间档（含自定义日期）+ 运动类型；两张导出卡共用一份 */
Component({
  properties: {
    ranges: { type: Array, value: [] },
    types: { type: Array, value: [] },
    range: { type: String, value: 'all' },
    type: { type: String, value: '' },
    start: { type: String, value: '' },
    end: { type: String, value: '' },
    today: { type: String, value: '' },
  },

  methods: {
    onRangeTap(e) {
      this.triggerEvent('rangechange', { key: e.currentTarget.dataset.key });
    },

    onTypeTap(e) {
      this.triggerEvent('typechange', { type: e.currentTarget.dataset.type || '' });
    },

    onStartChange(e) {
      this.triggerEvent('startchange', { value: e.detail.value });
    },

    onEndChange(e) {
      this.triggerEvent('endchange', { value: e.detail.value });
    },
  },
});

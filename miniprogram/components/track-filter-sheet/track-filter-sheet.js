// 轨迹合集页的筛选半屏：时间（本周/本月/本年/全部 + 历史年份）/ 省份 两段 chips。
// 草稿态——选完点「确定」才回传 confirm，「重置」只清草稿；关闭不动已生效的筛选。
// 候选项由页面算好后传进来（options），本组件不查库：省份跟随当前时间档、年份来自全量快照。
const tf = require('../../utils/track-filter.js');

Component({
  properties: {
    visible: { type: Boolean, value: false },
    value: { type: Object, value: null }, // 已生效的筛选 {period, province}
    options: { type: Object, value: null }, // {provinces:[{name,label,count}], years:[{year,count}]}
  },
  data: {
    draft: { period: tf.DEFAULT_PERIOD, province: '' },
    timeItems: [],
    provinceItems: [],
    noProvince: false,
  },
  observers: {
    // 打开态才重建：关闭时父级 setData 不该顺带把打开中的草稿抹掉
    'visible, value, options': function (visible, value, options) {
      if (!visible) return;
      this.open(value || {}, options || {});
    },
  },
  methods: {
    /** 每次打开都从「已生效筛选」起草稿：上次没点确定的选择不残留 */
    open(value, options) {
      const draft = {
        period: value.period || tf.DEFAULT_PERIOD,
        province: value.province || '',
      };
      const years = options.years || [];
      const provinces = options.provinces || [];
      this._lists = {
        // 时间是一维单选：四档与历史年份同一组 chips（选了年份就不再是档位），
        // 因此这里没有「全部」这种重置项——重置项只在省份段（「全部省份」）
        period: tf.RANGES.map((r) => ({ key: r.value, label: r.label })).concat(
          years.map((y) => ({ key: String(y.year), label: y.year + ' 年', count: y.count })),
        ),
        // 省份 key 用全名（与接口下发的 startProvince 精确匹配），label 只用于显示短名
        province: [{ key: '', label: '全部省份' }].concat(provinces.map((p) => ({ key: p.name, label: p.label, count: p.count }))),
      };
      this.setData({ draft, noProvince: provinces.length === 0 });
      this.render();
    },
    /** 草稿 → 视图（active 由 draft 现算，切 chip 只重算这两份） */
    render() {
      const draft = this.data.draft;
      const paint = (items, activeKey) =>
        (items || []).map((it) => Object.assign({}, it, { active: it.key === activeKey }));
      this.setData({
        timeItems: paint(this._lists.period, draft.period),
        provinceItems: paint(this._lists.province, draft.province),
      });
    },
    onChipTap(e) {
      const { field, key } = e.currentTarget.dataset;
      if (field !== 'period' && field !== 'province') return;
      const draft = Object.assign({}, this.data.draft);
      draft[field] = key; // 时间必选一档（点当前档即不变）；省份的「全部省份」key 是空串
      this.setData({ draft });
      this.render();
    },
    onReset() {
      this.setData({ draft: { period: tf.DEFAULT_PERIOD, province: '' } });
      this.render();
    },
    onConfirm() {
      const d = this.data.draft;
      this.triggerEvent('confirm', { period: d.period, province: d.province });
    },
    onClose() {
      this.triggerEvent('close');
    },
    noop() {},
  },
});

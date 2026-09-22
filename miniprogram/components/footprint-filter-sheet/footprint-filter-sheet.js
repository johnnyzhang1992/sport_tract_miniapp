// 足迹地图页的筛选半屏：省份 / 年份 / 分类三段 chips。
// 草稿态——选完点「确定」才回传 confirm，「重置」只清草稿；再点已选中的 chip 等于取消该段。
// 候选项由页面用未过滤快照算好后传进来（options），本组件不查库。
const config = require('../../config/index.js');
const { shortProvinceName } = require('../../utils/footprint-filter.js');

const FIELDS = ['province', 'year', 'category'];
const EMPTY_DRAFT = { province: '', year: '', category: '' };

Component({
  properties: {
    visible: { type: Boolean, value: false },
    value: { type: Object, value: null }, // 当前已生效的筛选 {province, year, category}
    options: { type: Object, value: null }, // {provinces, years, categories}
    // tab 页的弹层底边在 tabBar 上方，不含屏幕底部安全区，由页面传 false
    safeBottom: { type: Boolean, value: true },
  },
  data: {
    draft: Object.assign({}, EMPTY_DRAFT),
    sections: [],
    empty: false,
  },
  observers: {
    'visible, value, options': function (visible, value, options) {
      if (!visible) return; // 关闭态不重建：避免父级 setData 顺带把打开中的草稿抹掉
      this.open(value || {}, options || {});
    },
  },
  methods: {
    /** 每次打开都从「已生效筛选」起草稿：上次没点确定的选择不残留 */
    open(value, options) {
      const draft = {
        province: value.province || '',
        year: value.year ? String(value.year) : '',
        category: value.category || '',
      };
      this._lists = {
        // chip 只显示短名（新疆维吾尔自治区 这类长名一行摆不下几个）；key 仍是全名，
        // 回传给 /geo 的 province 要和库里的 location.province 对得上，不能跟着截。
        province: (options.provinces || []).map((p) => ({ key: p.name, label: shortProvinceName(p.name), count: p.count })),
        year: (options.years || []).map((y) => ({ key: String(y.year), label: y.year + ' 年', count: y.count })),
        category: (options.categories || []).map((c) => ({
          key: c.key,
          label: config.footprintCategoryLabel(c.key) || c.key,
          icon: config.footprintCategoryIcon(c.key),
          count: c.count,
        })),
      };
      this.setData({ draft });
      this.render();
    },
    /** 草稿 → 视图：每段以「全部」开头，active 由 draft 现算，切 chip 只重算这一份 */
    render() {
      const draft = this.data.draft;
      const sections = FIELDS.map((field) => ({
        field,
        title: { province: '省份', year: '年份', category: '分类' }[field],
        items: [{ key: '', label: '全部', count: 0, active: !draft[field] }].concat(
          (this._lists[field] || []).map((it) => Object.assign({}, it, { active: draft[field] === it.key })),
        ),
      }));
      this.setData({
        sections,
        empty: FIELDS.every((f) => (this._lists[f] || []).length === 0),
      });
    },
    onChipTap(e) {
      const { field, key } = e.currentTarget.dataset;
      if (FIELDS.indexOf(field) < 0) return;
      const draft = Object.assign({}, this.data.draft);
      draft[field] = draft[field] === key ? '' : key; // 「全部」的 key 是空串，点它即清空
      this.setData({ draft });
      this.render();
    },
    onReset() {
      this.setData({ draft: Object.assign({}, EMPTY_DRAFT) });
      this.render();
    },
    onConfirm() {
      const d = this.data.draft;
      this.triggerEvent('confirm', { province: d.province, year: d.year, category: d.category });
    },
    onClose() {
      this.triggerEvent('close');
    },
    noop() {},
  },
});

// 足迹列表页（地图页右下「列表」入口进）：顶部 列表/日历 两态 + 总览文案 + 搜索 + 分页卡片 + 详情/表单半屏。
// 列表态：搜索 + 月/年/全部时间筛选 + 按月分组卡片；日历态：月历打点 + 当月（或点选的某天）卡片列表。
const api = require('../../services/api');
const config = require('../../config/index');
const { RANGES, PICKER_COUNT, periodRange, periodLabelOf } = require('../../utils/footprint-period.js');
const cal = require('../../utils/footprint-calendar.js');
const { ensureLogin } = require('../../utils/login-gate');

const STATS_URL = '/packageFootprint/pages/footprint-stats/footprint-stats';

/**
 * 卡片展示字段在 JS 侧一次算好（WXML 不能 join 数组、不能给缺失字段兜底）：
 * 日期徽章拆成 dayNum/monthNum，地址与同行拼成 metaText，照片行用缩略图档（列表接口不下发原图，
 * 一屏 10 条 × 3 图拉原图是 30MB 量级；点开详情的 previewImage 才用原图）。
 * openDetail 收的是原 DTO 字段，附加字段不影响详情组件的快路径。
 */
function toCard(r) {
  const people = Array.isArray(r.people) ? r.people.filter(Boolean) : [];
  const photoThumbs = Array.isArray(r.photoThumbs) ? r.photoThumbs.filter(Boolean) : [];
  const loc = r.location || {};
  const place = loc.address || loc.city || loc.name || '';
  const ymd = String(r.visitDate || '').split('-');
  return Object.assign({}, r, {
    peopleText: people.join('、'),
    dayNum: ymd[2] ? String(Number(ymd[2])) : '',
    monthNum: ymd[1] ? `${Number(ymd[1])}月` : '',
    metaText: [place || '未知地点', people.length ? `和${people.join('、')}` : ''].filter(Boolean).join(' · '),
    descText: r.description || '',
    categoryLabel: config.footprintCategoryLabel(r.category),
    categoryIcon: config.footprintCategoryIcon(r.category),
    photoThumbs,
  });
}

Page({
  data: {
    view: 'list', // list | calendar
    summaryText: '', // 「4 条记录 · 4 个地方 · 18 张照片」（全局口径，不随筛选变）
    calendarMonth: '', // YYYY-MM
    calendarDays: [], // 接口全量打点，换月在本地过滤
    calendarSelected: '', // 点选的具体某天，'' = 整月
    sectionTitle: '', // 列表区的分组/月份标题
    emptyText: '',
    groups: [], // 列表态：按月分组（日历态单月，直接渲染 items）
    loading: true,
    error: '',
    items: [], // toCard 后的完整 DTO（点卡片直接开详情，不再二次请求）
    page: 1, pageSize: 20, total: 0, hasMore: true, loadingList: false,
    totalCount: 0, // 全局记录总数（/calendar 口径）：分享文案用
    placeCount: 0, // 全局地方数（distinct 地点名）：分享文案用
    // 筛选态：keywordInput 是输入框内容（不请求），keyword 是点「搜索」/回车后生效的词
    keywordInput: '',
    keyword: '',
    ranges: RANGES,
    activeRange: 'all', // 默认全部：列表默认行为与加筛选前一致
    periodOffset: 0, // 往前的周期数（0=当前月/年）
    periodLabel: '',
    canGoNext: false,
    showPeriodPicker: false,
    periodOptions: [], // [{offset, label, compact, selected}]
    pickerScrollInto: '',
    filtered: false, // 是否有生效的筛选（空态文案与「清空筛选」入口按它分档）
    detailVisible: false,
    detailRecord: null,
    notLoggedIn: false, // 游客态（只可能从分享链接直达）：不发请求，摆登录引导
    formVisible: false,
    formRecord: null, // null = 新增态（顶部 ＋），带记录 = 编辑态（详情「编辑」带出）
  },
  onLoad() {
    this.setData({ calendarMonth: cal.currentMonth() });
    this.applyPeriod();
    this.syncSection();
    this.syncData();
  },

  /**
   * 登录态与页面数据对齐（onLoad / 登录成功后都走这里）。
   * 本地有 token 的老用户先静默恢复；仍是游客就一个请求都不发——列表与 /calendar 都会 401。
   * hasMore 一并压掉：否则游客触底会去翻页，白挨一个 401 toast。
   */
  async syncData() {
    const app = getApp();
    if (app.hasSession() && !app.globalData.loggedIn) {
      try {
        await app.login();
      } catch (e) {
        // 静默恢复失败就按游客处理，别在进页时甩一个错误弹窗
      }
    }
    if (!app.globalData.loggedIn) {
      this.setData({
        loading: false,
        error: '',
        notLoggedIn: true,
        items: [],
        groups: [],
        summaryText: '',
        emptyText: '',
        totalCount: 0,
        placeCount: 0,
        hasMore: false,
        loadingList: false,
      });
      return;
    }
    this.setData({ notLoggedIn: false });
    const loading = this.loadAll();
    this.loadCalendar();
    return loading;
  },

  /** 空列表上的登录引导：与 ＋ 走同一道闸门 */
  onLoginTap() {
    ensureLogin().then((ok) => {
      if (ok) this.syncData();
    });
  },

  onPullDownRefresh() {
    // 走 syncData 而不是直接两个请求：游客（分享链接直达）下拉时两个接口都 401，
    // loadAll 的首屏失败分支还会把登录引导顶成整页错误态
    this.syncData().finally(() => wx.stopPullDownRefresh());
  },

  /** 触底翻页：不提前清空 items，追加由 fetchPage 的 page > 1 分支负责 */
  onReachBottom() {
    if (!this.data.hasMore || this.data.loadingList) return;
    const seq = this._seq; // 发请求前先记下当前序号，回退时据此判断这次翻页是否已被新请求接管
    const next = this.data.page + 1;
    this.setData({ page: next });
    this.fetchPage(seq).catch(() => {
      // 翻页失败要退回上一页码，否则这次触底白翻一页、数据留空洞；
      // 三个条件缺一不可：seq 变了说明已被 loadAll 接管（页码已归 1，回退会写出错误页码），
      // loadingList 为 true 说明有更新的一页在飞（此时 this.data.page 属于那次请求，不能按 next 回退），
      // page !== next 说明页码已被别处改动
      if (seq === this._seq && !this.data.loadingList && this.data.page === next) this.setData({ page: next - 1 });
    });
  },

  /* ------------------------------ 形态切换与总览 ------------------------------ */

  onSwitchView(e) {
    const view = e.currentTarget.dataset.view;
    if (!view || view === this.data.view) return;
    // 不清 items：与切时间档一致，新数据到达后整体替换，切态不留空窗
    this.setData({ view, calendarSelected: '' });
    this.applyPeriod();
    this.syncFiltered();
    this.loadAll();
    if (view === 'calendar' && !this._calLoaded) this.loadCalendar();
  },

  /** 总览文案 + 日历打点：一次 /calendar 全量拿（换月不再请求） */
  loadCalendar() {
    const seq = (this._calSeq = (this._calSeq || 0) + 1);
    return api
      .get('/footprint-records/calendar')
      .then((data) => {
        if (seq !== this._calSeq) return;
        const d = data || {};
        this._calLoaded = true;
        this.setData({
          calendarDays: d.days || [],
          // 全局口径：分享文案要用它（列表此刻可能正被筛着，屏上那几行不代表全部）
          totalCount: d.total || 0,
          placeCount: d.placeCount || 0,
          summaryText: cal.summaryText({ total: d.total, placeCount: d.placeCount, photoCount: d.photoCount }),
        });
      })
      .catch((e) => {
        // 静默失败会让总览/打点凭空消失，按 bug 处理：给出具体原因
        wx.showToast({ title: (e && e.message) || '日历数据加载失败', icon: 'none' });
      });
  },

  goStats() {
    wx.navigateTo({ url: STATS_URL });
  },

  /** 转发文案：用 /calendar 的全局口径（列表可能正被筛着，屏上那几行不代表全部） */
  shareTitle() {
    const n = this.data.totalCount;
    if (!(n > 0)) return '在小迹一下记录去过的每个地方';
    const places = this.data.placeCount;
    return places > 0 ? `我记录了 ${n} 条足迹 · ${places} 个地方` : `我记录了 ${n} 条足迹`;
  },

  onShareAppMessage() {
    return { title: this.shareTitle(), path: '/pages/footprint-list/footprint-list' };
  },

  /** 分享到朋友圈 */
  onShareTimeline() {
    return { title: this.shareTitle() };
  },

  /** 顶部 ＋：新增态表单（record 传 null 即新增），保存后 onFormSaved 统一刷新。
   *  写操作前过登录闸门（游客只可能从分享链接直达本页）；已登录走同帧直开，不绕微任务 */
  openAdd() {
    if (getApp().globalData.loggedIn) return this.setData({ formVisible: true, formRecord: null });
    ensureLogin().then((ok) => {
      if (!ok) return;
      this.syncData();
      this.setData({ formVisible: true, formRecord: null });
    });
  },

  /* ------------------------------ 日历态交互 ------------------------------ */

  onCalendarMonthChange(e) {
    const month = (e.detail && e.detail.month) || '';
    if (!month || month === this.data.calendarMonth) return;
    this.setData({ calendarMonth: month, calendarSelected: '' });
    this.applyPeriod();
    this.syncFiltered();
    this.loadAll();
  },

  /** 点某天 → 下方只列那天；再点同一天取消，回到整月 */
  onCalendarDayTap(e) {
    const date = (e.detail && e.detail.date) || '';
    if (!date) return;
    this.setData({ calendarSelected: this.data.calendarSelected === date ? '' : date });
    this.applyPeriod();
    this.syncFiltered();
    this.loadAll();
  },

  /* ------------------------------ 搜索与时间筛选 ------------------------------ */

  /** 输入不请求：只同步输入框内容（生效词仍是 keyword） */
  onKeywordInput(e) { this.setData({ keywordInput: e.detail.value }); },

  /** 点「搜索」或键盘回车：输入词去首尾空格后落成生效词，重拉第一页 */
  onSearch() {
    const kw = (this.data.keywordInput || '').trim();
    this.setData({ keywordInput: kw, keyword: kw });
    this.syncFiltered();
    this.loadAll();
  },

  /** 清空搜索：清输入框与生效词并立即重搜（时间筛选不动） */
  onClearKeyword() {
    if (!this.data.keywordInput && !this.data.keyword) return;
    this.setData({ keywordInput: '', keyword: '' });
    this.syncFiltered();
    this.loadAll();
  },

  /** 时间档切换（月/年/全部）：偏移归零后重拉 */
  onRangeChange(e) {
    const value = e.currentTarget.dataset.value;
    if (value === this.data.activeRange) return;
    this.setData({ activeRange: value, periodOffset: 0 });
    this.applyPeriod();
    this.syncFiltered();
    this.loadAll();
  },

  /** 翻到上一周期（更早） */
  onPrevPeriod() {
    this.setData({ periodOffset: this.data.periodOffset + 1 });
    this.applyPeriod();
    this.loadAll();
  },

  /** 翻回下一周期（当前周期后不可再翻） */
  onNextPeriod() {
    if (this.data.periodOffset <= 0) return;
    this.setData({ periodOffset: this.data.periodOffset - 1 });
    this.applyPeriod();
    this.loadAll();
  },

  /**
   * 按当前形态算请求区间：
   * 日历态 = 点选的那一天 [date, 次日) 或整月 [月初, 下月初)；
   * 列表态 = 月/年档的周期区间，「全部」不带 from/to。
   */
  applyPeriod() {
    const { view, activeRange, periodOffset, calendarMonth, calendarSelected } = this.data;
    if (view === 'calendar') {
      this._period = calendarSelected ? cal.dayRange(calendarSelected) : cal.monthRange(calendarMonth);
      this.setData({ periodLabel: '', canGoNext: false });
      return;
    }
    if (activeRange === 'all') {
      this._period = null;
      this.setData({ periodLabel: '', canGoNext: false });
      return;
    }
    const p = periodRange(activeRange, periodOffset);
    this._period = p;
    this.setData({ periodLabel: periodLabelOf(activeRange, p), canGoNext: periodOffset > 0 });
  },

  /** 打开周期抽屉：按粒度生成最近 N 个周期选项（对齐统计页），nextTick 滚动定位到当前项 */
  onTapPeriodLabel() {
    const { activeRange, periodOffset } = this.data;
    if (activeRange === 'all') return;
    const count = PICKER_COUNT[activeRange] || 12;
    const options = [];
    for (let offset = 0; offset < count; offset++) {
      const label = periodLabelOf(activeRange, periodRange(activeRange, offset));
      options.push({ offset, label, compact: label.length > 12, selected: offset === periodOffset });
    }
    this.setData({ showPeriodPicker: true, periodOptions: options, pickerScrollInto: '' });
    wx.nextTick(() => {
      this.setData({ pickerScrollInto: `period-${this.data.periodOffset}` });
    });
  },
  onClosePeriodPicker() { this.setData({ showPeriodPicker: false }); },

  /** 抽屉里选中某个周期：选中当前项只关抽屉，选别的项才切换重拉 */
  onSelectPeriod(e) {
    const offset = Number(e.currentTarget.dataset.offset);
    this.setData({ showPeriodPicker: false });
    if (offset === this.data.periodOffset) return;
    this.setData({ periodOffset: offset });
    this.applyPeriod();
    this.loadAll();
  },

  /** 清空筛选（空态引导）：搜索清空 + 时间回「全部」（日历态顺带清掉点选的某天） */
  onClearFilter() {
    this.setData({ keywordInput: '', keyword: '', activeRange: 'all', periodOffset: 0, calendarSelected: '' });
    this.applyPeriod();
    this.syncFiltered();
    this.loadAll();
  },

  /** filtered 标记：空态文案与「清空筛选」入口按它分档 */
  syncFiltered() {
    const { keyword, activeRange, view, calendarSelected } = this.data;
    this.setData({ filtered: !!(keyword || (view === 'list' && activeRange !== 'all') || (view === 'calendar' && calendarSelected)) });
  },

  /** 列表区标题与空态文案：分组、月份标题、无数据提示都在这算，wxml 只做展示 */
  syncSection() {
    const { view, calendarSelected, items, total, filtered } = this.data;
    const patch = {
      groups: view === 'list' ? cal.groupByMonth(items) : [],
      sectionTitle: '',
      emptyText: '',
    };
    if (view === 'calendar') {
      patch.sectionTitle = calendarSelected ? `${cal.dayLabel(calendarSelected)} · ${total} 条` : `本月 ${total} 条`;
      patch.emptyText = calendarSelected ? `${cal.dayLabel(calendarSelected)} 没有足迹` : '本月没有足迹';
    } else if (filtered) {
      patch.emptyText = '没有匹配的足迹';
    }
    this.setData(patch);
  },

  async loadAll() {
    // 请求序号守卫：只应用最后一次结果，防竞态
    const seq = (this._seq = (this._seq || 0) + 1);
    // 仅首屏才进 loading 态；刷新保留已渲染内容，防闪屏
    const firstLoad = this.data.items.length === 0;
    this.setData(firstLoad ? { loading: true, error: '' } : { error: '' });
    // 不提前清空 items：第一页响应到达后再整体替换（见 fetchPage），刷新时列表不留空窗
    this.setData({ page: 1, hasMore: true });
    try {
      await this.fetchPage(seq);
      if (seq !== this._seq) return;
      this.setData({ loading: false });
    } catch (e) {
      if (seq !== this._seq) return;
      this.setData({ loading: false, loadingList: false });
      if (firstLoad) {
        // 首屏失败没有可展示的内容 → 整页错误态
        this.setData({ error: (e && e.message) || '加载失败' });
      } else {
        // 刷新失败：已渲染内容仍然可用，只提示不打断（整页错误态留给首屏）
        this.setData({ error: '' });
        wx.showToast({ title: (e && e.message) || '刷新失败', icon: 'none' });
      }
    }
  },
  fetchPage(seq) {
    this.setData({ loadingList: true });
    const page = this.data.page;
    // 请求只带生效中的筛选（输入框里没提交的词不带）；区间由 applyPeriod 决定
    const params = { page, pageSize: this.data.pageSize };
    if (this.data.keyword) params.keyword = this.data.keyword;
    if (this._period) {
      params.from = this._period.from;
      params.to = this._period.to;
    }
    return api
      .get('/footprint-records', params)
      .then((data) => {
        if (seq !== this._seq) return;
        // page 1（首屏/刷新）替换整页；page > 1（触底）追加
        const fresh = (data.items || []).map(toCard);
        const items = page === 1 ? fresh : this.data.items.concat(fresh);
        // 触底闸门：只看 hasMore + loadingList，不算页码。
        // fresh 为空也要落下 hasMore，否则后端 total 与实际条数不一致时会一直重试同一页
        this.setData({
          items,
          total: data.total,
          hasMore: fresh.length > 0 && items.length < data.total,
          loadingList: false,
        });
        this.syncSection();
      })
      .catch((e) => {
        if (seq === this._seq) this.setData({ loadingList: false });
        throw e;
      });
  },

  /** 点卡片（分组内外同一处理）：items 是完整 DTO，按 id 取，详情组件走快路径不再二次请求 */
  onCardTap(e) {
    const id = e.currentTarget.dataset.id;
    const r = this.data.items.find((x) => x.id === id);
    if (r) this.openDetail(r);
  },

  /** 详情半屏：轻量/完整 DTO 都行（缺字段由组件补拉 GET /:id，seq 守卫在组件内） */
  openDetail(record) {
    if (!record) return;
    this.setData({ detailVisible: true, detailRecord: record });
  },
  closeDetail() { this.setData({ detailVisible: false, detailRecord: null }); },
  /** 详情里点「编辑」：关详情、带完整记录就地开表单 */
  onDetailEdit(e) {
    this.setData({ detailVisible: false, detailRecord: null, formVisible: true, formRecord: e.detail });
  },
  /** 详情里删除成功：关详情并整页刷新（分页回第一页，避免页码落在已被删空的区间） */
  onDetailDeleted() {
    this.setData({ detailVisible: false, detailRecord: null });
    this.reloadAll();
  },
  closeForm() { this.setData({ formVisible: false, formRecord: null }); },
  /** 表单保存成功：关弹层 + 重拉第一页 */
  onFormSaved() {
    this.setData({ formVisible: false, formRecord: null });
    this.reloadAll();
  },
  /**
   * 数据变了：列表与总览/打点都要重取（新增、编辑、删除后共用）。
   * 顺带打跨页脏标记——本页是从地图 tab 上 navigateTo 推上来的，返回时地图页只走 onShow，
   * 靠这个标记才知道要补拉，否则删掉的点会一直挂在地图上。
   */
  reloadAll() {
    getApp().globalData.fpDirty = true;
    this.loadCalendar();
    this.loadAll();
  },
  noop() {},
});

// 足迹列表独立页（地图页左上「列表」入口进）：分页卡片列表 + 详情/表单半屏组件复用
const api = require('../../services/api');

/**
 * 卡片展示字段在 JS 侧一次算好：
 * WXML 不能对 people 数组做 join（直接渲染会变成 [object]），也不能给缺失的 location 兜底，
 * 故卡片额外挂 peopleText / subText / cover（openDetail 收的是原 DTO 字段，附加字段不影响快路径）。
 */
function toCard(r) {
  const people = Array.isArray(r.people) ? r.people.filter(Boolean) : [];
  const photos = Array.isArray(r.photos) ? r.photos.filter(Boolean) : [];
  const loc = r.location || {};
  return Object.assign({}, r, {
    peopleText: people.join('、'),
    subText: [r.visitDate, loc.city || loc.address || loc.name || '未知地点'].filter(Boolean).join(' · '),
    cover: photos[0] || '',
  });
}

Page({
  data: {
    loading: true,
    error: '',
    items: [], // toCard 后的完整 DTO（点卡片直接开详情，不再二次请求）
    page: 1, pageSize: 20, total: 0, hasMore: true, loadingList: false,
    detailVisible: false,
    detailRecord: null,
    formVisible: false, // 从详情「编辑」进；本页无新增入口（新增在地图页 FAB）
    formRecord: null,
  },
  onLoad() { this.loadAll(); },

  onPullDownRefresh() { this.loadAll().finally(() => wx.stopPullDownRefresh()); },

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
    return api
      .get('/footprint-records', { page, pageSize: this.data.pageSize })
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
      })
      .catch((e) => {
        if (seq === this._seq) this.setData({ loadingList: false });
        throw e;
      });
  },

  onCardTap(e) {
    const r = this.data.items[Number(e.currentTarget.dataset.idx)];
    if (r) this.openDetail(r); // items 是完整 DTO：详情组件走快路径，不再二次请求
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
    this.loadAll();
  },
  closeForm() { this.setData({ formVisible: false, formRecord: null }); },
  /** 表单保存成功：关弹层 + 重拉第一页 */
  onFormSaved() {
    this.setData({ formVisible: false, formRecord: null });
    this.loadAll();
  },
  noop() {},
});

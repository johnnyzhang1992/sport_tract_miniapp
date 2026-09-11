/** 专题详情页（官方信息）：markdown 正文 + 封面，游客可看 */
const api = require('../../services/api');
const loading = require('../../utils/loading');
const { markdownToHtml } = require('../../utils/markdown');

Page({
  data: {
    topic: null, // { id, title, coverUrl, content(渲染后 HTML), effectiveAt }
    loading: true,
    failed: false,
  },

  onLoad(options) {
    const id = options.id || '';
    this._lastId = id;
    if (!id) {
      this.setData({ loading: false, failed: true });
      return;
    }
    this.fetch(id);
  },

  async fetch(id) {
    loading.show('加载中…');
    try {
      const data = await api.get(`/topics/${id}`);
      this.setData({
        topic: {
          id: data.id,
          title: data.title,
          coverUrl: data.coverUrl,
          html: markdownToHtml(data.content),
          dateText: this.formatDate(data.effectiveAt),
        },
        loading: false,
      });
      wx.setNavigationBarTitle({ title: data.title || '专题' });
    } catch (e) {
      console.error('加载专题失败', e);
      this.setData({ loading: false, failed: true });
    } finally {
      loading.hide();
    }
  },

  formatDate(ts) {
    const d = new Date(ts);
    if (!ts || Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  },

  onRetry() {
    if (this._lastId) {
      this.setData({ loading: true, failed: false });
      this.fetch(this._lastId);
    }
  },

  /** 分享 */
  onShareAppMessage() {
    const t = this.data.topic;
    return {
      title: t ? t.title : '小迹一下 · 专题',
      path: `/pages/topic/topic${t ? `?id=${t.id}` : ''}`,
    };
  },
});

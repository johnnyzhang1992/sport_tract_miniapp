/**
 * 徽章墙（2026-11-16）：从 plan-history 抽出的通用徽章渲染组件。
 *
 * 两个使用方：
 *   - pages/plan-history  计划页：只显示计划类徽章（category="plan"）
 *   - pages/badges        我的徽章页：显示全部（category="all"）
 *
 * 只负责「根据 props 渲染 + 把点击抛给父页面」，不自己取数据；
 * 展示字段（shortLabel/shape/groupTitle/badgeText）全部来自服务端。
 * 形状 → 样式类、类型图标、中央文字这几个「纯展示翻译」统一走 utils/badge-shape.js。
 */
const { shapeClassOf, centerTextOf, typeIconOf, isRingBadge } = require('../../utils/badge-shape.js');

Component({
  properties: {
    /** 徽章扁平表（服务端 /plan/summary 或 /plan/badges 的 trophies） */
    trophies: { type: Array, value: [] },
    /** 分区顺序：服务端下发的 badges.groups（含 title/category），为空时按 trophies 出现顺序 */
    groups: { type: Array, value: [] },
    /** 只显示某个大类：'plan' | 'data' | 'all' */
    category: { type: String, value: 'all' },
    /** 是否显示「已获得」汇总区（放在分区网格之前） */
    showEarned: { type: Boolean, value: true },
    /** 已获得区的标题（默认「已获得」） */
    earnedTitle: { type: String, value: '已获得' },
    /** 空态文案 */
    emptyText: { type: String, value: '还没有获得徽章，完成每日计划即可解锁第一座' },
  },

  data: {
    /** 渲染用：分组后的徽章 + 已获得汇总 */
    view: { groups: [], earnedList: [], earnedCount: 0, totalCount: 0 },
  },

  observers: {
    'trophies, groups, category': function () {
      this.build();
    },
  },

  lifetimes: {
    attached() {
      this.build();
    },
  },

  methods: {
    build() {
      const all = (this.data.trophies || []).filter(Boolean);
      const category = this.data.category;
      const list = category === 'all' ? all : all.filter((t) => t.category === category);

      // 分组：优先按服务端 groups 的顺序，再补上 groups 里没列到的（防御）
      const order = [];
      for (const g of (this.data.groups || [])) {
        if (category !== 'all' && g.category && g.category !== category) continue;
        order.push({ key: g.key, title: g.title });
      }
      const byGroup = new Map();
      const groups = [];
      const push = (key, title) => {
        if (byGroup.has(key)) return byGroup.get(key);
        const g = { key, title, items: [] };
        byGroup.set(key, g);
        groups.push(g);
        return g;
      };
      // 先按服务端顺序建空组，保证「有分组但没徽章」时不出现（后面只留非空）
      for (const o of order) push(o.key, o.title);
      for (const t of list) {
        const g = push(t.group, t.groupTitle || '徽章');
        g.items.push({
          key: t.key,
          label: t.shortLabel || t.label || t.key,
          unlocked: !!t.unlocked,
          earnedCount: t.earnedCount ?? 0,
          earnDateText: t.earnDateText || '',
          pct: t.pct ?? 0,
          cls: shapeClassOf(t.shape),
          badgeText: centerTextOf(t),
          isRing: isRingBadge(t),
          typeIcon: typeIconOf(t),
        });
      }
      const nonEmpty = groups.filter((g) => g.items.length);

      // 已获得汇总：按获取日期倒序，同日保持服务端原顺序
      const earned = list.filter((t) => t.unlocked)
        .map((t, i) => ({ t, i }))
        .sort((a, b) => {
          const d = String(b.t.earnDateText || '').localeCompare(String(a.t.earnDateText || ''));
          return d !== 0 ? d : a.i - b.i;
        })
        .map(({ t }) => t)
        .map((t) => ({
          key: t.key,
          shortLabel: t.shortLabel || t.label || t.key,
          earnDateText: t.earnDateText || '',
          cls: shapeClassOf(t.shape),
          badgeText: centerTextOf(t),
          isRing: isRingBadge(t),
          typeIcon: typeIconOf(t),
        }));

      this.setData({
        view: {
          groups: nonEmpty,
          earnedList: earned,
          earnedCount: earned.length,
          totalCount: list.length,
        },
      });
    },

    onTapItem(e) {
      const key = e.currentTarget.dataset.key;
      if (!key) return;
      // 交给父页面处理（用 action safe：父页面自己打开详情半屏）
      this.triggerEvent('select', { key });
    },
  },
});
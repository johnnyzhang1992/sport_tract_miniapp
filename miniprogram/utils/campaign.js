/**
 * 一起运动活动（campaign）纯函数：状态 / 可见性标签、时间范围、加入按钮、汇总格式化。
 * 标签文案只住这一份（R22）：首页区块、列表页、创建/详情页都从这里取，别再往 config/index.js 放。
 * 运行：node --test test/campaign-util.test.js。
 */

const STATUS_LABEL = { active: '进行中', ended: '已结束', dissolved: '已解散' };
const VISIBILITY_LABEL = { public: '公开', private: '隐私' };

/** 未知档位原样透传：后端加档时不至于是空白 */
function statusLabel(s) {
  return STATUS_LABEL[s] || s;
}

function visibilityLabel(v) {
  return VISIBILITY_LABEL[v] || v;
}

/** epoch → 东八区 MM-DD */
function bjMMDD(ms) {
  const d = new Date(ms + 8 * 3600000);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${mm}-${dd}`;
}

/** endAt 是「结束日 24:00」＝次日 0 点，展示时减 1ms 回到结束日 */
function fmtRange(startAt, endAt) {
  return `${bjMMDD(startAt)} ~ ${bjMMDD(endAt - 1)}`;
}

/**
 * 加入按钮文案与禁用态：按「我的状态 → 活动状态 → 可否加入」依次判。
 * 已加入（myState='joined'，含发起人）不显示按钮，返回 null。
 */
function joinCta({ myState, canJoin, status, visibility }) {
  if (myState === 'joined') return null;
  if (status === 'dissolved') return { text: '活动已解散', disabled: true };
  if (status === 'ended') return { text: '活动已结束', disabled: true };
  if (myState === 'pending') return { text: '等待发起人同意', disabled: true };
  if (myState === 'removed') return { text: '你已被移出该活动', disabled: true };
  if (canJoin) return { text: visibility === 'private' ? '申请加入' : '加入活动', disabled: false };
  return { text: '人数已满', disabled: true };
}

/**
 * 汇总面板格式化（左闭右开口径无关，纯展示）：
 * 次数 / 距离 km 两位小数 / 时长（≥1h 为 h+m，否则 min）。
 * 列表卡片 DTO 的 myStats 没有 streak（只有详情 myPanel 有），缺省归 0。
 */
function fmtPanel({ count = 0, streak = 0, distance = 0, duration = 0 }) {
  const km = (distance / 1000).toFixed(2);
  const h = Math.floor(duration / 3600);
  const m = Math.round((duration % 3600) / 60);
  return {
    countText: `${count}`,
    streakText: `${streak}`,
    distanceText: `${km}`,
    durationText: h > 0 ? `${h}h${m}m` : `${m}min`,
  };
}

module.exports = { statusLabel, visibilityLabel, fmtRange, joinCta, fmtPanel };

/**
 * 一起运动活动（campaign）纯函数：状态 / 可见性标签、时间范围、加入按钮、汇总格式化。
 * 标签文案只住这一份（R22）：首页区块、列表页、创建/详情页都从这里取，别再往 config/index.js 放。
 * 运行：node --test test/campaign-util.test.js。
 */

const STATUS_LABEL = { upcoming: '未开始', active: '进行中', ended: '已结束', dissolved: '已解散' };
const VISIBILITY_LABEL = { public: '公开', private: '隐私' };

/** 未知档位原样透传：后端加档时不至于是空白 */
function statusLabel(s) {
  return STATUS_LABEL[s] || s;
}

function visibilityLabel(v) {
  return VISIBILITY_LABEL[v] || v;
}

/**
 * 状态 → 标签修饰类。样式只有一份（app.wxss 的 .campaign-tag），详情页与列表卡片都用它。
 * 基类本身就是中性灰，所以「已结束」以及后端将来新加的状态都返回空串落回基类，
 * 不会出现一条没样式的裸标签——与 statusLabel 的「未知原样透传」同一取向。
 */
const STATUS_TAG_MOD = {
  upcoming: 'campaign-tag--upcoming',
  active: 'campaign-tag--active',
  dissolved: 'campaign-tag--dissolved',
};
function statusTagClass(s) {
  return STATUS_TAG_MOD[s] || '';
}

/** epoch → 东八区 MM/DD（withYear 时 YYYY/MM/DD）。活动全套页面统一用「/」当日期间隔符 */
function bjDate(ms, withYear) {
  const d = new Date(ms + 8 * 3600000);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return withYear ? `${d.getUTCFullYear()}/${mm}/${dd}` : `${mm}/${dd}`;
}

/**
 * 'YYYY-MM-DD'（picker 与接口的**规范**格式）→ 展示用 'YYYY/MM/DD'。
 * 只用于展示：上送值、picker 的 value 一律保持连字符格式（服务端 campaignDateField 是严格 YYYY-MM-DD）。
 */
function slashDate(iso) {
  return String(iso || '').replace(/-/g, '/');
}

/** 详情页时间范围：两端都带完整年月日（地址栏级别的日期，少一年会让人误判）。
 *  endAt 是「结束日 24:00」＝次日 0 点，展示时减 1ms 回到结束日。 */
function fmtRange(startAt, endAt) {
  return `${bjDate(startAt, true)} ~ ${bjDate(endAt - 1, true)}`;
}

/** 带标签的时间行：`开始 2026/10/01 · 结束 2026/10/07`。
 *  两端一律带完整年月日（与详情页同口径）——旧版只在跨年时补年份，非当年的活动卡片会缺年份。 */
function fmtRangeLabeled(startAt, endAt) {
  const endMs = endAt - 1; // 同 fmtRange：endAt 是次日 0 点
  return `开始 ${bjDate(startAt, true)} · 结束 ${bjDate(endMs, true)}`;
}

/**
 * 占位圆里的首字：必须按**码点**取（Array.from）。昵称以 emoji 开头时 `name[0]` 切的是 UTF-16
 * 码元，会留下半个代理对 → 渲染成乱码方块（和 truncateName 同一个坑）。
 */
function initialOf(name, fallback) {
  return Array.from(String(name || fallback || ''))[0] || '';
}

/** 成员头像堆叠的数据：签名 url 优先 → 回退预设图 → 都没有时用昵称首字画占位圆 */
function avatarStack(list) {
  return (list || []).map((m, i) => ({
    key: i,
    src: m.avatarUrl || (m.avatarPreset ? `/assets/avatars/${m.avatarPreset}.png` : ''),
    text: initialOf(m.nickname, '微信用户'),
  }));
}

/**
 * 昵称截断：最多 max 个字符，超出则截前 max 个再补「...」。
 * 必须按**码点**切（Array.from）：按 UTF-16 码元切会把 emoji 的代理对劈成半个，
 * 渲染出乱码方块（昵称里带 emoji 很常见）。「最多 max 个字」指昵称本身，省略号另算。
 */
function truncateName(name, max) {
  const chars = Array.from(String(name == null ? '' : name));
  return chars.length > max ? `${chars.slice(0, max).join('')}...` : chars.join('');
}

/**
 * 加入按钮文案与禁用态：按「我的状态 → 活动状态 → 可否加入」依次判。
 * 已加入（myState='joined'，含发起人）不显示按钮，返回 null。
 * 主动退出过（myState='left'）只是**措辞**不同（重新加入 / 重新申请），可参加性完全由 `canJoin` 决定——
 * 所以这条分支必须待在 `canJoin` 为真的分支里：人数已满 / 已结束 / 已解散时仍落到既有文案，不会误放行（R27）。
 */
function joinCta({ myState, canJoin, status, visibility }) {
  if (myState === 'joined') return null;
  if (status === 'dissolved') return { text: '活动已解散', disabled: true };
  if (status === 'ended') return { text: '活动已结束', disabled: true };
  if (myState === 'pending') return { text: '等待发起人同意', disabled: true };
  if (myState === 'removed') return { text: '你已被移出该活动', disabled: true };
  if (canJoin) {
    const again = myState === 'left';
    if (again) return { text: visibility === 'private' ? '重新申请' : '重新加入', disabled: false };
    return { text: visibility === 'private' ? '申请加入' : '加入活动', disabled: false };
  }
  return { text: '人数已满', disabled: true };
}

/**
 * 汇总面板格式化（左闭右开口径无关，纯展示）：
 * 次数 / 距离 km 两位小数 / 时长（中文单位：满 1 小时走「N小时M分钟」，整点省掉「0分钟」，不足 1 小时走「M分钟」）。
 * 列表卡片 DTO 的 myStats 没有 streak（只有详情 myPanel 有），缺省归 0。
 */
function fmtPanel({ count = 0, streak = 0, distance = 0, duration = 0 }) {
  const km = (distance / 1000).toFixed(2);
  const totalMinutes = Math.round(duration / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return {
    countText: `${count}`,
    streakText: `${streak}`,
    distanceText: `${km}`,
    durationText: h > 0 ? (m > 0 ? `${h}小时${m}分钟` : `${h}小时`) : `${m}分钟`,
  };
}

module.exports = { statusLabel, visibilityLabel, statusTagClass, fmtRange, fmtRangeLabeled, avatarStack, joinCta, fmtPanel, truncateName, initialOf, slashDate };

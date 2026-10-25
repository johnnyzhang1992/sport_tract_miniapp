/** dateKey 'YYYY-MM-DD' → 'MM.DD'：七格 sub 与胶囊 label 共用它，保证两处显示永远同格式 */
const md = (dateKey) => dateKey.slice(5).replace('-', '.');

/**
 * 七格：只做「状态 → 显示」的映射，位置、分值与可补判定一律由服务端 cells 决定（spec §5.1）。
 * 客户端不再自推当前格/断口——以前前后各推一遍、两边口径对不上，正是这次改版的收口点。
 */
function buildSigninStrip(cells, todayKey) {
  return (cells || []).map((c) => {
    const dot = c.state === 'signed' ? '✓'
      : c.state === 'makeup' ? '补'
        : c.state === 'missed' ? '未'
          : `+${c.reward}`;
    // 「今天/明天」按 dateKey 比对：起点会被可补格往前挪，今天不一定落在第 7 格
    let sub = md(c.dateKey);
    if (c.dateKey === todayKey) sub = '今天';
    else if (c.dateKey === shiftDateKey(todayKey, 1)) sub = '明天';
    return { dateKey: c.dateKey, state: c.state, dot, sub, reward: c.reward };
  });
}

/** 补签胶囊：state === 'makeup' 是可补判定的唯一来源，每个可补日一颗；todayRewardAfter 供弹窗文案「补完今天可拿 N 分」 */
function buildMakeupChips(cells, cards) {
  // cards 由 summary 以数字下发；`> 0` 对 undefined/null/0 一律 false，端上不再做 Number 收口
  const hasCard = cards > 0;
  return (cells || [])
    .filter((c) => c.state === 'makeup')
    .map((c) => ({
      dateKey: c.dateKey,
      label: `补签 ${md(c.dateKey)}`,
      sub: hasCard ? `剩 ${cards} 张卡` : '去兑换',
      hasCard,
      todayRewardAfter: c.todayRewardAfter || 0,
    }));
}

/** 'YYYY-MM-DD' ± delta 天：纯 UTC 算术，不因本地时区漂日（dateKey 的东八区归属由服务端/bjDate 负责） */
function shiftDateKey(dateKey, delta) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

function buildTaskRows(tasks) {
  const rows = (tasks || []).map((t) => ({
    key: t.key, title: t.title, points: t.points, status: t.status,
    actionText: t.actionText, disabled: t.status !== 'claimable',
  }));
  // 未完成的排前面（含 locked/expired），已领取沉底；两组内部都保持接口原序（新手→每日）
  return rows.filter((r) => r.status !== 'claimed').concat(rows.filter((r) => r.status === 'claimed'));
}

/** 道具卡：接口下发整张商品表，卡片图位用名称首字（与头像首字占位同一套做法） */
function buildItemCards(items) {
  return (items || []).map((it) => ({
    key: it.key,
    name: it.name,
    subtitle: it.subtitle,
    price: it.price,
    validDays: it.validDays,
    glyph: (it.name || '').charAt(0),
  }));
}

module.exports = { buildSigninStrip, buildMakeupChips, shiftDateKey, buildTaskRows, buildItemCards };

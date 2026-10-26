/** dateKey 'YYYY-MM-DD' → 'MM.DD'：七格 sub 与胶囊 label 共用它，保证两处显示永远同格式；
 *  导出给兑换记录页的「已补签 MM.DD」复用——同一张日期别让一处 10-24 一处 10.24（Task 8 收口） */
const md = (dateKey) => dateKey.slice(5).replace('-', '.');

/**
 * 七格：只做「状态 → 显示」的映射，位置、分值与可补判定一律由服务端 cells 决定（spec §5.1）。
 * 客户端不再自推当前格/断口——以前前后各推一遍、两边口径对不上，正是这次改版的收口点。
 * makeup 格自带 todayRewardAfter（补完今天可拿几分，弹窗文案用）——点格子即补签，不再有第二套胶囊入口。
 */
function buildSigninStrip(cells, todayKey) {
  return (cells || []).map((c) => {
    // 已签格的圆圈里放「+该日实得积分」（cells.reward = min(连签第N天,7)），替代对勾
    const dot = c.state === 'signed' ? `+${c.reward}`
      : c.state === 'makeup' ? '补'
        : c.state === 'missed' ? '未'
          : `+${c.reward}`;
    // 「今天/明天」按 dateKey 比对：起点会被可补格往前挪，今天不一定落在第 7 格
    let sub = md(c.dateKey);
    if (c.dateKey === todayKey) sub = '今天';
    else if (c.dateKey === shiftDateKey(todayKey, 1)) sub = '明天';
    return {
      dateKey: c.dateKey,
      state: c.state,
      dot,
      sub,
      reward: c.reward,
      todayRewardAfter: c.todayRewardAfter || 0,
    };
  });
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
    // 三态按钮配色：claimable 实心蓝（可领）/ locked 描边蓝（去完成）/ claimed 浅灰（已完成）
    statusClass: t.status === 'claimed' ? 'done' : t.status === 'claimable' ? '' : 'off',
    once: String(t.key || '').startsWith('newbie_'), // 新手任务（一次性）与每日任务分卡展示
  }));
  // 未完成的排前面（含 locked/expired），已领取沉底；两组内部都保持接口原序（新手→每日）。
  // onceTasks 只收「未完成」的行：全部完成/过期后 onceTasks.length === 0，新手卡整卡隐藏
  const ordered = rows.filter((r) => r.status !== 'claimed').concat(rows.filter((r) => r.status === 'claimed'));
  return {
    onceTasks: ordered.filter((r) => r.once && r.status !== 'claimed'),
    dailyTasks: ordered.filter((r) => !r.once),
  };
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

module.exports = { buildSigninStrip, shiftDateKey, buildTaskRows, buildItemCards, md, buildTaskGroups: buildTaskRows };

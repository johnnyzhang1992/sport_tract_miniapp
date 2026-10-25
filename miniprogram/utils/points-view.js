const pad = (n) => String(n).padStart(2, '0');

function buildSigninStrip(signin, todayMs) {
  const streak = Math.min(Number(signin && signin.streakDay) || 0, 7);
  const signed = !!(signin && signin.todaySigned);
  const currentDay = signed ? streak : Math.min(streak + 1, 7);
  // 连签已满 7 天且今天没签：没有「当前格」，否则第 7 格会同时 done + current（同一格显示两个态）
  const currentAt = !signed && streak < 7 ? currentDay : 0;
  const base = new Date(todayMs + 8 * 3600000);
  const out = [];
  for (let i = 1; i <= 7; i++) {
    const done = i <= streak;
    const current = i === currentAt;
    const date = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + (i - currentDay)));
    let sub = `${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCDate())}`;
    if (current) sub = '今天';
    else if (i === currentDay + 1) sub = '明天';
    out.push({ reward: i, label: `+${i}`, sub, done, current });
  }
  return out;
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

module.exports = { buildSigninStrip, buildTaskRows, buildItemCards };

const { bjDate } = require('./bj-date');
const pad = (n) => String(n).padStart(2, '0');

function buildSigninStrip(signin, todayMs) {
  const streak = Math.min(Number(signin && signin.streakDay) || 0, 7);
  const signed = !!(signin && signin.todaySigned);
  const currentDay = signed ? streak : Math.min(streak + 1, 7);
  const base = new Date(todayMs + 8 * 3600000);
  const out = [];
  for (let i = 1; i <= 7; i++) {
    const done = i <= streak;
    const current = !signed && i === currentDay;
    const date = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + (i - currentDay)));
    let sub = `${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCDate())}`;
    if (current) sub = '今天';
    else if (i === currentDay + 1) sub = '明天';
    out.push({ reward: i, label: `+${i}`, sub, done, current });
  }
  return out;
}

function buildTaskRows(tasks) {
  return (tasks || []).map((t) => ({
    key: t.key, title: t.title, points: t.points, status: t.status,
    actionText: t.actionText, disabled: t.status !== 'claimable',
  }));
}

module.exports = { buildSigninStrip, buildTaskRows };

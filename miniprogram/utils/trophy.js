/**
 * 里程碑奖杯墙：固定五项（1K/5K/10K/半马/全马），服务端只下发已达成项。
 * 未达成的也占一格（置灰「未解锁」），让用户知道下一档目标。
 */
const TROPHY_DEFS = [
  { key: '1k', label: '1K', km: 1 },
  { key: '5k', label: '5K', km: 5 },
  { key: '10k', label: '10K', km: 10 },
  { key: 'half', label: '半马', km: 21.0975 },
  { key: 'full', label: '全马', km: 42.195 },
];

const DAY_MS = 86400000;

/** 公里数展示：整数不带小数，否则保留 1 位（半马 21.1 / 全马 42.2） */
function formatKm(km) {
  const v = Math.round(km * 10) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function buildTrophies(milestones, now = Date.now()) {
  const map = new Map();
  for (const m of milestones || []) {
    if (m && m.key) map.set(m.key, m);
  }
  return TROPHY_DEFS.map((def) => {
    const m = map.get(def.key);
    const startTime = m ? Number(m.startTime) || 0 : 0;
    return {
      key: def.key,
      label: def.label,
      km: def.km,
      unlocked: !!m,
      id: m ? String(m.id || '') : '',
      sec: m ? Number(m.sec) || 0 : 0,
      type: m ? m.type || '' : '',
      startTime,
      // 当前纪录保持天数（未来时间/缺失时间按 0，不出现负数）
      heldDays: startTime > 0 ? Math.max(0, Math.floor((now - startTime) / DAY_MS)) : 0,
      requirementText: `完成 ${formatKm(def.km)} km`,
    };
  });
}

module.exports = { buildTrophies };

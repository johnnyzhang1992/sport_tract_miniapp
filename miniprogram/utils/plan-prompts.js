/**
 * 计划页弹窗的规则与文案（2026-11-10；当期达成 2026-11-12 用户确认）
 * 1. 无计划进入计划页 → 提示创建（点「暂不」后 3 天内不再提示）
 * 2. 里程碑新解锁（含首次达成）→ 恭喜弹窗（同一里程碑只弹一次；一次解锁多个只弹最高档）
 * 2b. 当期达成（当天/本期三项都达标）→ 同期首次进页弹一次（本地按 periodKey 去重）
 * 3. 连续 3 个周期 ≥200% 超额 → 建议加量（「保持现状」后 7 天不再问；改了计划重新观察）
 * 纯函数 + 常量，弹窗本身在 plan-history 页里调 wx.showModal。
 */

/** 无计划创建提示的冷却：3 天 */
const CREATE_PROMPT_GAP_MS = 3 * 24 * 3600_000;
/** 加量建议点「保持现状」后的冷却：7 天 */
const RAISE_PROMPT_GAP_MS = 7 * 24 * 3600_000;
/** 加量触发：连续超额（≥200%）期数 */
const RAISE_OVER_STREAK = 3;
/** 超额判定线：最弱一项完成倍数 ≥ 200% */
const OVER_RATIO = 2;

/** 里程碑恭喜文案（key → 正文）；名称用服务端返回的 label（首次达成/坚持一周/…） */
const MILESTONE_COPY = {
  first: '第一次完成计划！万事开头难，你已经赢在了起点。',
  week: '达成 7 次！坚持一周，运动正在成为你的习惯。',
  habit: '达成 20 次！不用咬牙也能坚持，这就是习惯的力量。',
  x2: '单次完成到目标的 2 倍，这火力谁看了不喊一声猛！',
  x3: '单次完成到目标的 3 倍！三倍目标当日常，王者实至名归。',
  x4: '单次完成到目标的 4 倍！这个强度，已经超过 99% 的迹路者。',
  x5: '单次完成到目标的 5 倍！计划已经拦不住你，传奇请收下敬佩。',
};

/** 新增奖杯（docs/21）的恭喜文案：按分区给一句，key 用服务端完整 key（如 rec-dist-100） */
const TROPHY_COPY = {
  record: '单日运动纪录刷新！今天的你超过了昨天的自己。',
  streak: '连续运动天数达到新档位，坚持就是胜利。',
  rings: '圆环合上次数达到新档位，持续达标太强了。',
  goal: '累计完成运动次数达到新档位，里程碑 +1。',
  week: '收获一个完美周！这一周的计划全部兑现。',
};

/** 当期达成弹窗（2026-11-12 用户确认；周计划已下线，只剩每日口径） */
const ACHIEVE_COPY = {
  daily: { title: '今日目标达成', content: '三项计划全部完成，干得漂亮！', confirmText: '太棒了' },
};

/**
 * 无计划创建提示：距上次「暂不」不足 3 天则不提示（没有记录视为从未提示过）
 */
function shouldPromptCreatePlan(lastDeclinedTs, now = Date.now()) {
  const ts = Number(lastDeclinedTs) || 0;
  return now - ts >= CREATE_PROMPT_GAP_MS;
}

/**
 * 挑出「新解锁」的里程碑（unlocked 且没看过）。返回按服务端顺序（低→高档）排列的数组，
 * 调用方取最后一个即最高档。
 */
function pickNewMilestones(milestones, seenKeys) {
  const seen = new Set(seenKeys || []);
  return (milestones || []).filter((m) => m && m.unlocked && !seen.has(m.key));
}

/**
 * 挑出「新解锁」的奖杯（docs/21 新增 27 座，含合上圆环/完成目标/完美周等）。
 * 与里程碑同款规则：unlocked 且没看过；返回保持服务端顺序（低→高、稀有度递增），
 * 调用方取最后一个即最值得恭喜的一座。
 */
function pickNewTrophies(trophies, seenKeys) {
  const seen = new Set(seenKeys || []);
  return (trophies || []).filter((t) => t && t.unlocked && !seen.has(t.key));
}

/**
 * 加量建议：连续超额 ≥3 期，且计划没改过（签名一致——改了计划等于重新观察），
 * 且距上次「保持现状」≥7 天。签名用 period+targets 拼接，targets 任一项变了就重置。
 */
function shouldPromptRaisePlan({ overStreak, planSig, last, now = Date.now() }) {
  const s = Number(overStreak) || 0;
  if (s < RAISE_OVER_STREAK) return false;
  if (!planSig) return false;
  const rec = last || null;
  if (rec && rec.sig === planSig) {
    if (now - (Number(rec.ts) || 0) < RAISE_PROMPT_GAP_MS) return false;
  }
  return true;
}

/** 计划签名：周期 + 三项目标（任一变化 → 加量观察重新开始） */
function planSignature(plan) {
  if (!plan) return '';
  const t = plan.targets || {};
  return [plan.period, t.distanceM, t.durationMin, t.count].join('|');
}

module.exports = {
  CREATE_PROMPT_GAP_MS,
  RAISE_PROMPT_GAP_MS,
  RAISE_OVER_STREAK,
  OVER_RATIO,
  MILESTONE_COPY,
  TROPHY_COPY,
  ACHIEVE_COPY,
  shouldPromptCreatePlan,
  pickNewMilestones,
  pickNewTrophies,
  shouldPromptRaisePlan,
  planSignature,
};

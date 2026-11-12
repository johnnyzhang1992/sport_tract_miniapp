/**
 * 计划页弹窗的规则与文案（2026-11-10；当期达成 2026-11-12 用户确认）
 * 1. 无计划进入计划页 → 提示创建（点「暂不」后 3 天内不再提示）
 * 2. 里程碑新解锁（含首次达成）→ 恭喜弹窗（同一里程碑只弹一次；一次解锁多个只弹最高档）
 * 2b. 当期达成（当天/本周三项都达标）→ 同期首次进页弹一次（本地按 periodKey 去重）
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
  x2: '一个周期干到目标的 2 倍，这火力谁看了不喊一声猛！',
  x2pro: '200% 达成 20 次，稳定输出，宗师风范！',
  x3: '300% 达成 10 次！三倍目标当日常，王者实至名归。',
  x4: '400% 达成 5 次！这个强度，已经超过 99% 的迹路者。',
  x5: '500% 达成 3 次！计划已经拦不住你，传奇请收下敬佩。',
};

/** 当期达成弹窗（2026-11-12 用户确认：标题按周期、正文/按钮固定） */
const ACHIEVE_COPY = {
  daily: { title: '今日目标达成', content: '三项计划全部完成，干得漂亮！', confirmText: '太棒了' },
  weekly: { title: '本周目标达成', content: '三项计划全部完成，干得漂亮！', confirmText: '太棒了' },
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
  ACHIEVE_COPY,
  shouldPromptCreatePlan,
  pickNewMilestones,
  shouldPromptRaisePlan,
  planSignature,
};

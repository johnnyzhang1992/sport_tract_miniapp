/**
 * 计划页三处弹窗的规则纯函数（2026-11-10，文案已确认）：
 * 1. 无计划创建提示：3 天冷却；
 * 2. 里程碑恭喜：新解锁才弹，多个取最高档；
 * 3. 加量建议：连续 3 期 ≥200%，计划改动重置，「保持现状」后 7 天冷却。
 * 运行：node --test test/plan-prompts.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const prompts = require('../miniprogram/utils/plan-prompts.js');
const DAY = 24 * 3600_000;
const NOW = 1_700_000_000_000;

test('PP1 无计划提示：从未提示过弹；3 天冷却内不弹；过了 3 天再弹', () => {
  assert.equal(prompts.shouldPromptCreatePlan(0, NOW), true, '从未提示');
  assert.equal(prompts.shouldPromptCreatePlan(NOW - 3 * DAY + 1000, NOW), false, '冷却内');
  assert.equal(prompts.shouldPromptCreatePlan(NOW - 3 * DAY - 1, NOW), true, '冷却已过');
});

test('PP2 里程碑：只挑「已解锁且没看过」；多个按服务端顺序返回，末位即最高档', () => {
  const milestones = [
    { key: 'first', label: '首次达成', unlocked: true },
    { key: 'week', label: '坚持一周', unlocked: true },
    { key: 'habit', label: '习惯养成', unlocked: false },
    { key: 'x2', label: '双倍火力', unlocked: true },
  ];
  const news = prompts.pickNewMilestones(milestones, ['first']);
  assert.deepEqual(news.map((m) => m.key), ['week', 'x2'], '已看过的 first 不再出现，未解锁的不出现');
  assert.equal(news[news.length - 1].key, 'x2', '最高档在末位');

  assert.equal(prompts.pickNewMilestones(milestones, ['first', 'week', 'x2']).length, 0, '全看过 → 空数组');
  assert.equal(prompts.pickNewMilestones([], []).length, 0);
});

test('PP3 加量：连续超额 ≥3 期才触发', () => {
  const base = { planSig: 'daily|3000|0|0', now: NOW };
  assert.equal(prompts.shouldPromptRaisePlan({ ...base, overStreak: 2 }), false);
  assert.equal(prompts.shouldPromptRaisePlan({ ...base, overStreak: 3 }), true);
  assert.equal(prompts.shouldPromptRaisePlan({ ...base, overStreak: 5 }), true);
  assert.equal(prompts.shouldPromptRaisePlan({ ...base, overStreak: 0 }), false);
  assert.equal(prompts.shouldPromptRaisePlan({ ...base, overStreak: 3, planSig: '' }), false, '无计划不弹');
});

test('PP4 加量：「保持现状」后 7 天冷却；换计划（签名变化）立即重置可再问', () => {
  const sig = 'daily|3000|0|0';
  const declined = { ts: NOW - 2 * DAY, sig };
  assert.equal(
    prompts.shouldPromptRaisePlan({ overStreak: 4, planSig: sig, last: declined, now: NOW }),
    false,
    '7 天冷却内',
  );
  assert.equal(
    prompts.shouldPromptRaisePlan({ overStreak: 4, planSig: sig, last: { ts: NOW - 7 * DAY - 1, sig }, now: NOW }),
    true,
    '冷却已过再弹',
  );
  assert.equal(
    prompts.shouldPromptRaisePlan({ overStreak: 4, planSig: 'daily|5000|0|0', last: declined, now: NOW }),
    true,
    '计划改了 → 签名不同 → 重新观察、立即可问',
  );
});

test('PP5 计划签名：period 或任一目标变化 → 签名变化', () => {
  const sig = (p) => prompts.planSignature(p);
  const s1 = sig({ period: 'daily', targets: { distanceM: 3000, durationMin: 30, count: 1 } });
  assert.equal(s1, 'daily|3000|30|1');
  assert.notEqual(s1, sig({ period: 'weekly', targets: { distanceM: 3000, durationMin: 30, count: 1 } }));
  assert.notEqual(s1, sig({ period: 'daily', targets: { distanceM: 5000, durationMin: 30, count: 1 } }));
  assert.notEqual(s1, sig({ period: 'daily', targets: { distanceM: 3000, durationMin: 40, count: 1 } }));
  assert.notEqual(s1, sig({ period: 'daily', targets: { distanceM: 3000, durationMin: 30, count: 2 } }));
  assert.equal(sig(null), '');
});

test('PP6 文案：8 个里程碑都配了恭喜正文', () => {
  const keys = ['first', 'week', 'habit', 'x2', 'x2pro', 'x3', 'x4', 'x5'];
  for (const k of keys) {
    assert.equal(typeof prompts.MILESTONE_COPY[k], 'string');
    assert.ok(prompts.MILESTONE_COPY[k].length >= 10, `${k} 文案太短`);
  }
});

/**
 * 运动计划的表单口径（创建/更改计划半屏与后端共用同一套默认值与草稿规则）。
 * - 默认值：每天 3km/30 分钟/1 次；每周 15km/150 分钟/5 次
 * - 草稿：每个周期各存一份用户输入（storage 持久化），切周期/重开半屏都能还原
 */

const PLAN_DEFAULTS = {
  daily: { distanceKm: '3', durationMin: '30', count: '1' },
  weekly: { distanceKm: '15', durationMin: '150', count: '5' },
};

const DRAFT_KEY = 'planDraftV1';

function readDrafts() {
  try {
    const raw = wx.getStorageSync(DRAFT_KEY);
    return raw && typeof raw === 'object' ? raw : {};
  } catch (e) {
    return {};
  }
}

function writeDrafts(drafts) {
  try {
    wx.setStorageSync(DRAFT_KEY, drafts);
  } catch (e) {
    // 存储失败不影响填写
  }
}

/** 草稿是否有效：三项都已填写（空草稿＝没填过，回落到默认值） */
function validDraft(d) {
  return !!d && !!String(d.distanceKm || '').trim()
    && !!String(d.durationMin || '').trim()
    && !!String(d.count || '').trim();
}

/** 服务端 plan.targets（米/分钟/次）→ 表单值（km 字符串） */
function formOfPlan(plan) {
  if (!plan || !plan.targets) return null;
  return {
    distanceKm: String(Math.round((plan.targets.distanceM || 0) / 100) / 10),
    durationMin: String(plan.targets.durationMin || ''),
    count: String(plan.targets.count || ''),
  };
}

module.exports = { PLAN_DEFAULTS, readDrafts, writeDrafts, validDraft, formOfPlan };

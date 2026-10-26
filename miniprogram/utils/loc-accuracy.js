/**
 * 定位精度归一化（Android 机型 / 微信版本差异兜底）
 *
 * 背景（2026-10-26）：Android 15 + Redmi 23117RK66C 实测拿不到精度——落库轨迹 521 个点
 * accuracy 全为 null，导致所有基于精度的防线（accBad 抽稀保留 / 服务端精度因子 /
 * driftScore 权重）在这台设备上全部失效。
 *
 * 可能的成因与对策（都在这一个函数里兜）：
 * 1) 微信桥把数字返回成字符串（"5"）——旧代码 `typeof v === 'number'` 直接判 null；
 * 2) 不同端/版本字段名不同：accuracy / horizontalAccuracy / verticalAccuracy；
 * 3) 返回 0 或负数表示「无有效精度」——旧逻辑会把它当完美精度（0 不大于任何阈值），
 *    比 null 更危险（弱信号段会被当成高质量点全量收录）；
 * 4) 离谱值（> 1000m，通常是无定位兜底值）同样视为无效。
 *
 * 口径：只有「> 0 且 <= 1000 的有限数值（含数字字符串）」才算有效精度，其余一律 null
 * （null = 未知，下游按「不做精度判断」处理，与旧数据同路径）。
 */

/** 精度字段候选（按优先级）：accuracy 是微信文档标准字段，另两个部分端/版本才有 */
const ACCURACY_KEYS = ['accuracy', 'horizontalAccuracy', 'verticalAccuracy'];

/** 有效精度的合理上限（米）：超过它不是「精度差」而是没定位，按未知处理 */
const MAX_PLAUSIBLE_ACCURACY_M = 1000;

/** 宽松转数字：number / 数字字符串 → 有限数；其余（undefined/null/''/NaN/对象）→ null */
function toFiniteNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const s = v.trim();
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * 从定位回调对象里解析精度（米，整数）；无法判定返回 null
 * @param {object|null|undefined} loc wx.onLocationChange / wx.getLocation 的回调对象
 * @returns {number|null}
 */
function resolveAccuracy(loc) {
  if (!loc) return null;
  for (const key of ACCURACY_KEYS) {
    const n = toFiniteNumber(loc[key]);
    if (n != null && n > 0 && n <= MAX_PLAUSIBLE_ACCURACY_M) return Math.round(n);
  }
  return null;
}

/**
 * 诊断用：这次回调里有哪些精度相关字段、值是什么
 * 设备拿不到精度时打到 console，便于用户开 vConsole 后回传机型差异
 */
function describeAccuracyFields(loc) {
  if (!loc) return null;
  const out = {};
  for (const key of ACCURACY_KEYS) {
    if (loc[key] !== undefined) out[key] = loc[key];
  }
  return out;
}

module.exports = { resolveAccuracy, describeAccuracyFields, MAX_PLAUSIBLE_ACCURACY_M, ACCURACY_KEYS };

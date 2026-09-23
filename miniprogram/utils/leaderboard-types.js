/**
 * 运动榜分类 chips 排序（「有数据的排前面」）
 * 计数来自 GET /stats/leaderboard-type-counts（各类型 finished 轨迹数，8 类零填充）。
 * 排序必须稳定：计数相同（含全 0 与脏计数）时保持 config.ACTIVITY_TYPES 原序，
 * 否则接口抖动会让 chips 乱跳；缺项、非数字、负数一律当 0。
 */

function toCountMap(counts) {
  const map = new Map();
  (Array.isArray(counts) ? counts : []).forEach((row) => {
    if (!row || typeof row.type !== 'string') return;
    const n = Number(row.count);
    map.set(row.type, Number.isFinite(n) && n > 0 ? n : 0);
  });
  return map;
}

/** 返回新数组：按 count 降序，同 count 保持入参顺序 */
function sortTypesByCount(types, counts) {
  const list = Array.isArray(types) ? types : [];
  const map = toCountMap(counts);
  return list
    .map((t, i) => ({ t, i, n: map.get(t && t.type) || 0 }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((x) => x.t);
}

/** chips 重排后按 type 找回下标（保住用户当前选中项）；找不到返回 -1 */
function indexOfType(types, type) {
  if (!Array.isArray(types) || !type) return -1;
  return types.findIndex((t) => t && t.type === type);
}

/**
 * 页面一次性落地：按计数重排 + 保住当前选中项
 * @param {{ types: Array, counts: Array|null, currentType: string }} p
 * @returns {{ types: Array, typeIndex: number }} 计数拿不到时退化为原序，选中项仍在原位
 */
function applyTypeCounts({ types, counts, currentType } = {}) {
  const sorted = sortTypesByCount(Array.isArray(types) ? types : [], counts);
  const idx = indexOfType(sorted, currentType);
  return { types: sorted, typeIndex: idx >= 0 ? idx : 0 };
}

module.exports = { sortTypesByCount, indexOfType, applyTypeCounts };

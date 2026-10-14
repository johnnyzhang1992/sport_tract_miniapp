/**
 * 轨迹地图展示抽稀： setData 传给地图组件的点集从全量（上限 2 万点）降到视觉等效的
 * 少量点——地图渲染在屏幕分辨率下根本画不出 10 米内的两个点，全量点只会拖慢
 * setData 序列化（2 万点 ≈ 2MB，远超官方建议的单次 256KB）。
 *
 * 保真约定（与 track-map 组件的切分逻辑对齐）：
 * - pauseGap / gapJump 为真的点必保留（组件按这两个标记断开连线，段首点丢了段就粘住）；
 * - 每个连续 run 的首尾点必保留（折线端点不能缩水）；
 * - 打点切分（splitByMarkers）按"最近点"匹配，无需为它保留特定点；
 * - 保留点原样引用（不复制字段），海拔/时间戳/vehicle 标记随点带走，着色/回放不受影响。
 *
 * 配额按 run 长度加权分配，每个 run 至少保留首尾 2 点。
 */

/** 地图展示点数上限：足够画平滑曲线，远低于 setData 舒适区 */
const MAP_MAX_POINTS = 1500;

/** 断段标记：与 utils/track-pace.js#splitByUnreliableLinks 同口径 */
function isBreakPoint(p) {
  return !!(p && (p.pauseGap === true || p.gapJump === true));
}

/** 按断段标记切 run：标记点作为新 run 的首点 */
function splitRuns(points) {
  const runs = [];
  let run = [points[0]];
  for (let i = 1; i < points.length; i++) {
    if (isBreakPoint(points[i])) {
      runs.push(run);
      run = [points[i]];
    } else {
      run.push(points[i]);
    }
  }
  runs.push(run);
  return runs;
}

/**
 * @param {Array} points 全量轨迹点
 * @param {number} maxPoints 展示点数上限（默认 1500）
 * @returns {Array} 点数 ≤ maxPoints 的子集（原点引用）；不需要抽稀时原数组返回
 */
function simplifyForMap(points, maxPoints = MAP_MAX_POINTS) {
  if (!Array.isArray(points) || points.length <= maxPoints) return points;

  const runs = splitRuns(points);
  // 配额：按 run 长度加权，每 run 保底 2（首尾）
  const totalLen = runs.reduce((s, r) => s + r.length, 0);
  const quotas = runs.map((r) => Math.max(2, Math.round((r.length / totalLen) * maxPoints)));

  const out = [];
  runs.forEach((run, i) => {
    const quota = quotas[i];
    if (run.length <= quota) {
      out.push(...run);
      return;
    }
    // 均匀步进抽样：首尾必留，步长向下取整保证不超配额
    const stride = (run.length - 1) / (quota - 1);
    for (let j = 0; j < quota; j++) {
      out.push(run[Math.round(j * stride)]);
    }
  });
  return out;
}

module.exports = { simplifyForMap, MAP_MAX_POINTS };

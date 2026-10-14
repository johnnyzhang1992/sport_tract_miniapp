/**
 * 轨迹地图展示抽稀：setData 传给地图组件的点集从全量（上限 2 万点）降到视觉等效的
 * 少量点——地图渲染在屏幕分辨率下不需要 2 万个点，全量点只会拖慢 setData 序列化
 * （2 万点 ≈ 2MB，远超官方建议的单次 256KB）。
 *
 * 抽稀算法：道格拉斯-普克（DP）形状保真 + 按预算二分容差。相比均匀步进，
 * DP 优先保留高曲率点（锐利弯道/之字路不会在放大后被拉直），直线段大幅精简——
 * 同样 3000 点预算下形状保真度显著更高。
 *
 * 保真约定（与 track-map 组件的切分逻辑对齐）：
 * - pauseGap / gapJump 为真的点必保留（组件按这两个标记断开连线，段首点丢了段就粘住）；
 * - 每个连续 run 的首尾点必保留（DP 天然保留端点；折线端点不能缩水）；
 * - 打点切分（splitByMarkers）按"最近点"匹配，无需为它保留特定点；
 * - 保留点原样引用（不复制字段），海拔/时间戳/vehicle 标记随点带走，着色/回放不受影响。
 *
 * 配额按 run 长度加权分配，每个 run 至少保留首尾 2 点。
 */

/** 地图展示点数上限：形状保真预算 + setData 负担的平衡点（约 360KB） */
const MAP_MAX_POINTS = 3000;

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

/** 点到线段 ab 的距离（平面近似：经度按中点纬度缩放，run 内局部坐标足够准） */
function perpDistM(p, a, b) {
  const k = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const ax = a.lng * k;
  const ay = a.lat;
  const bx = b.lng * k;
  const by = b.lat;
  const px = p.lng * k;
  const py = p.lat;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) {
    const ex = px - ax;
    const ey = py - ay;
    return Math.sqrt(ex * ex + ey * ey) * 111320;
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const ex = px - (ax + t * dx);
  const ey = py - (ay + t * dy);
  return Math.sqrt(ex * ex + ey * ey) * 111320;
}

/** 迭代式 DP（避免 2 万点递归爆栈）：eps 下保留端点与所有偏距 > eps 的点 */
function douglasPeucker(points, eps) {
  const n = points.length;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    if (e - s < 2) continue;
    let maxD = -1;
    let maxI = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpDistM(points[i], points[s], points[e]);
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxD > eps) {
      keep[maxI] = 1;
      stack.push([s, maxI], [maxI, e]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/** 外包框对角线长（米）：容差二分的上界 */
function bboxDiagM(points) {
  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const dx = (maxLng - minLng) * k * 111320;
  const dy = (maxLat - minLat) * 111320;
  return Math.sqrt(dx * dx + dy * dy);
}

/** 在 budget 内找最大的容差（输出点数随容差单调不增，二分可行） */
function dpWithinBudget(points, budget) {
  if (points.length <= budget) return points;
  let lo = 0;
  let hi = bboxDiagM(points);
  let best = null;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const out = douglasPeucker(points, mid);
    if (out.length <= budget) {
      best = out;
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return best && best.length >= 2 ? best : [points[0], points[points.length - 1]];
}

/**
 * @param {Array} points 全量轨迹点
 * @param {number} maxPoints 展示点数预算（默认 3000）
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
    out.push(...dpWithinBudget(run, quotas[i]));
  });
  return out;
}

module.exports = { simplifyForMap, MAP_MAX_POINTS };

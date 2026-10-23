/**
 * 轨迹列表地图缩略图：抽稀点 → 微信 map 组件的 polyline / include-points。
 * - pauseGap / gapJump 处断开折线，断点本身保留；
 * - 按配速着色：沿用详情页口径（45s 滑动窗口平滑 + 按运动类型的绝对刻度 4 档绿→红）；
 *   无时间戳时回退品牌蓝单色线；疑似乘车段灰显。
 */
const { splitByUnreliableLinks, computeSegPaces } = require('./track-pace');
const { getPaceScale } = require('./pace-scale');

const TRACK_COLOR = '#2B6CF6';
const PACE_COLORS = ['#22c55e', '#facc15', '#f97316', '#ef4444']; // 慢 → 快
const VEHICLE_COLOR = '#c9cdd4';
const LINE_WIDTH = 2;

function toCoord(p) {
  return { latitude: Number(p.lat), longitude: Number(p.lng) };
}

/**
 * @param {Array<{lat:number,lng:number,timestamp?:number|null,pauseGap?:boolean,gapJump?:boolean,vehicle?:boolean}>} points
 * @param {string} [activityType] 运动类型（决定配速绝对刻度）
 * @returns {{polyline:Array, includePoints:Array, fitPoints:Array, center:{latitude:number,longitude:number}}|null}
 */
function buildMapView(points, activityType) {
  const valid = (Array.isArray(points) ? points : []).filter(
    (p) =>
      p &&
      p.lat != null &&
      p.lng != null &&
      p.lat !== '' &&
      p.lng !== '' &&
      Number.isFinite(Number(p.lat)) &&
      Number.isFinite(Number(p.lng)),
  );
  if (valid.length < 2) return null;

  const segments = splitByUnreliableLinks([valid]);
  if (!segments.length) return null;

  const segPaces = computeSegPaces(segments);
  const hasPace = segPaces.some((paces) => paces.some((p) => p != null));

  const polyline = [];
  if (!hasPace) {
    // 无时间戳/无法算配速：回退单色蓝线
    for (const seg of segments) {
      polyline.push({
        points: seg.map(toCoord),
        color: TRACK_COLOR,
        width: LINE_WIDTH,
        arrowLine: false,
      });
    }
  } else {
    const scale = getPaceScale(activityType);
    const fastPace = scale.fast;
    const slowPace = scale.slow;
    const span = slowPace - fastPace || 1;
    const N = PACE_COLORS.length;
    // 越接近 fast 越红（快），越接近 slow 越绿（慢）；超刻度截断
    const colorOf = (pace) => {
      const k = Math.min(1, Math.max(0, (slowPace - pace) / span));
      return PACE_COLORS[Math.min(N - 1, Math.floor(k * N))];
    };

    segments.forEach((seg, si) => {
      const paces = segPaces[si] || [];
      let cur = null;
      for (let i = 1; i < seg.length; i++) {
        const a = seg[i - 1];
        const b = seg[i];
        const pace = paces[i];
        const color = b.vehicle
          ? VEHICLE_COLOR
          : pace != null
            ? colorOf(pace)
            : PACE_COLORS[0]; // 原地/无数据按最慢档
        const pt = toCoord(b);
        if (cur && cur.color === color) {
          cur.points.push(pt);
        } else {
          cur = {
            color,
            points: [toCoord(a), pt],
            width: LINE_WIDTH,
            arrowLine: false,
          };
          polyline.push(cur);
        }
      }
    });
  }
  if (!polyline.length) return null;

  // 视野留白：include-points 会贴边适配，加一圈 12% 的包围盒角点让轨迹不顶边
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of valid) {
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  const padLat = (maxLat - minLat) * 0.12 || 0.0005;
  const padLng = (maxLng - minLng) * 0.12 || 0.0005;
  const fitPoints = [
    { latitude: minLat, longitude: minLng },
    { latitude: maxLat, longitude: minLng },
    { latitude: maxLat, longitude: maxLng },
    { latitude: minLat, longitude: maxLng },
  ];
  const includePoints = [
    { latitude: minLat - padLat, longitude: minLng - padLng },
    { latitude: maxLat + padLat, longitude: minLng - padLng },
    { latitude: maxLat + padLat, longitude: maxLng + padLng },
    { latitude: minLat - padLat, longitude: maxLng + padLng },
  ];

  return {
    polyline,
    includePoints,
    fitPoints,
    center: toCoord(valid[0]),
  };
}

/**
 * 可视行判定：视口上下各留 margin 预加载。
 * @param {Array<{id:string,top:number,bottom:number}>} rects
 * @param {number} windowHeight
 * @param {number} margin
 * @returns {Set<string>} 轨迹 id 集合
 */
function visibleMapIds(rects, windowHeight, margin = 240) {
  const ids = new Set();
  for (const r of Array.isArray(rects) ? rects : []) {
    if (!r || typeof r.id !== 'string' || !r.id.startsWith('map-item-')) continue;
    if (r.bottom > -margin && r.top < windowHeight + margin) {
      ids.add(r.id.slice('map-item-'.length));
    }
  }
  return ids;
}

/**
 * 地图节点保活淘汰：可视行永不卸载；已挂载数超过 cap 时，按最近一次可见时间
 * 从旧到新淘汰非可视行。短距离来回滚动不会反复重建原生 map。
 * @param {{mounted:Set<string>, visible:Set<string>, seen:Map<string,number>, cap:number}} opts
 * @returns {Set<string>} 需要卸载的 id
 */
function selectMapEvictions({ mounted, visible, seen, cap }) {
  const keep = Math.max(cap, visible.size);
  const over = mounted.size - keep;
  if (over <= 0) return new Set();
  const candidates = [...mounted]
    .filter((id) => !visible.has(id))
    .sort((a, b) => (seen.get(a) || 0) - (seen.get(b) || 0));
  return new Set(candidates.slice(0, over));
}

module.exports = { buildMapView, visibleMapIds, selectMapEvictions, PACE_COLORS, TRACK_COLOR };

/**
 * 聚合分享海报的几何纯函数：区域分组 / 等比投影 / 远端区域贴边落位。
 *
 * 背景（2026-09-25）：聚合模式原先是「密集区放大到画布 70% + 其余轨迹按方位摆到同一半径圆环」，
 * 实测全部档 45 条里 37 条外围，全挤在一圈上互相重叠、还被画布裁掉。而且用户数据是跨城的
 * （武汉 ~25 条 / 上海 ~20 条 / 深圳 1 条）：只要有一条远端轨迹点数够多，点级分位就挡不住它，
 * 整张海报会被压成一个小点。现在改成按「区域」处理：
 *   - 主区域 = 轨迹条数最多的那一簇，按真实经纬度等比铺满画布；
 *   - 其余远端区域各缩成一张贴边小格（格内仍按该区域的真实相对位置画），按方位就近落位，
 *     方框之间用精确碰撞检测保证不重叠。
 *
 * 坐标约定：bearing 以正东为 0、逆时针为正（与屏幕 y 轴向下相配：y = cy - sin(bearing) * r）。
 */

const DEG_LAT_KM = 111;
/** 主区域跨度下限（km）：防止单点/极小范围把 scale 顶到无穷；核心区性价比的跨度下限同此值 */
const MIN_SPAN_KM = 0.05;
/** 贴边小格方位锚点数（东/东北/北/…/东南 共 8 个） */
const EDGE_ANCHORS = 8;
/** 默认「同区域」判定阈值（km）：同城轨迹并成一组，跨城各自成组 */
const DEFAULT_GROUP_KM = 30;

/** 该纬度上 1° 经度对应的公里数 */
function kmPerDegLng(lat) {
  return DEG_LAT_KM * Math.cos((lat * Math.PI) / 180);
}

function median(sorted) {
  const n = sorted.length;
  if (!n) return 0;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

/** 一组 bbox 的并集 */
function unionBbox(list) {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  list.forEach((b) => {
    if (b.minLat < minLat) minLat = b.minLat;
    if (b.maxLat > maxLat) maxLat = b.maxLat;
    if (b.minLng < minLng) minLng = b.minLng;
    if (b.maxLng > maxLng) maxLng = b.maxLng;
  });
  if (!isFinite(minLat)) return null;
  return { minLat, maxLat, minLng, maxLng };
}

/** 一条轨迹的 bbox；无有效点返回 null */
function trackBbox(track) {
  const points = (track && track.points) || [];
  const valid = points.filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (!valid.length) return null;
  return unionBbox(valid.map((p) => ({ minLat: p.lat, maxLat: p.lat, minLng: p.lng, maxLng: p.lng })));
}

/**
 * 轨迹按「区域」分组：以全部点的中位坐标为参考，按中心距离从近到远贪心并组
 * （与已有组的代表点距离 ≤ groupKm 就并进去）。返回按「采样点数 → 条数」倒序的组，
 * 因此 groups[0] 就是用户停留最久的区域（主区域），其余是远端区域。
 * 为什么主区域按点数而不是条数：跨城数据里「出差城市碎轨迹多、家里单条长」很常见，
 * 按条数会把主图翻到出差城市；点数（≈采样时长）才和本周/本月档的主图保持一致。
 */
function groupTracks(tracks, opts) {
  const groupKm = (opts && opts.groupKm) || DEFAULT_GROUP_KM;
  const items = [];
  (tracks || []).forEach((track, index) => {
    const bbox = trackBbox(track);
    if (!bbox) return;
    items.push({
      index,
      track,
      bbox,
      centerLat: (bbox.minLat + bbox.maxLat) / 2,
      centerLng: (bbox.minLng + bbox.maxLng) / 2,
      points: ((track && track.points) || []).length,
    });
  });
  if (!items.length) return [];

  const cLat = median(items.map((i) => i.centerLat).sort((a, b) => a - b));
  const cLng = median(items.map((i) => i.centerLng).sort((a, b) => a - b));
  const kLng = kmPerDegLng(cLat) || DEG_LAT_KM;
  const dist = (lat, lng, lat2, lng2) =>
    Math.hypot((lat - lat2) * DEG_LAT_KM, (lng - lng2) * kLng);

  items.forEach((i) => {
    i.d = dist(i.centerLat, i.centerLng, cLat, cLng);
  });
  items.sort((a, b) => a.d - b.d);

  const groups = [];
  items.forEach((i) => {
    const g = groups.find((x) => dist(i.centerLat, i.centerLng, x.centerLat, x.centerLng) <= groupKm);
    if (!g) {
      groups.push({ items: [i], centerLat: i.centerLat, centerLng: i.centerLng });
      return;
    }
    g.items.push(i);
    // 代表点取组内均值，保证长条区域也能吸住后续轨迹
    g.centerLat = g.items.reduce((s, x) => s + x.centerLat, 0) / g.items.length;
    g.centerLng = g.items.reduce((s, x) => s + x.centerLng, 0) / g.items.length;
  });

  groups.forEach((g) => {
    g.count = g.items.length;
    g.points = g.items.reduce((s, x) => s + x.points, 0);
    g.bbox = unionBbox(g.items.map((x) => x.bbox));
  });
  groups.sort((a, b) => b.points - a.points || b.count - a.count);
  return groups;
}

/** 拆出主区域（groups[0]）与远端区域，并给远端区域相对主区域中心的真实方位角 */
function splitGroups(groups) {
  const list = Array.isArray(groups) ? groups : [];
  if (!list.length) return { main: null, extras: [] };
  const main = list[0];
  const cLat = (main.bbox.minLat + main.bbox.maxLat) / 2;
  const cLng = (main.bbox.minLng + main.bbox.maxLng) / 2;
  const kLng = kmPerDegLng(cLat) || DEG_LAT_KM;
  const extras = list.slice(1).map((g) => ({
    ...g,
    bearing: Math.atan2((g.centerLat - cLat) * DEG_LAT_KM, (g.centerLng - cLng) * kLng),
  }));
  return { main, extras };
}

/** 两个方位角的最小夹角（弧度，[0, π]） */
function angleDiff(a, b) {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

/**
 * 远端区域贴边落位：沿 8 个方位各放一个锚点（射线与内缩后的画布边界相交处），
 * 每个区域按真实方位就近挑未被占用的锚点，再用精确方框碰撞检测兜底，
 * 因此任意两个小格都不重叠、也不会越出 frame。锚点用完的按方位顺序截断并回报 dropped。
 */
function layoutEdgeBoxes(extras, opts) {
  const frame = opts.frame;
  const size = opts.size;
  const gap = opts.gap != null ? opts.gap : 8;
  const wall = opts.wall != null ? opts.wall : 6;
  const cx = (frame.left + frame.right) / 2;
  const cy = (frame.top + frame.bottom) / 2;
  const rx = (frame.right - frame.left) / 2 - wall - size / 2;
  const ry = (frame.bottom - frame.top) / 2 - wall - size / 2;

  const anchors = [];
  for (let i = 0; i < EDGE_ANCHORS; i++) {
    const bearing = (i / EDGE_ANCHORS) * Math.PI * 2;
    anchors.push({ bearing, x: cx + Math.cos(bearing) * rx, y: cy - Math.sin(bearing) * ry });
  }

  const placed = [];
  const dropped = [];
  const taken = [];
  (extras || []).forEach((e) => {
    const bearing = e.bearing || 0;
    const free = anchors
      .filter((a) => !taken.includes(a))
      .sort((a, b) => angleDiff(a.bearing, bearing) - angleDiff(b.bearing, bearing));
    const hit = free.find(
      (a) => !placed.some((p) => Math.abs(p.x - a.x) < size + gap && Math.abs(p.y - a.y) < size + gap),
    );
    if (!hit) {
      dropped.push(e);
      return;
    }
    taken.push(hit);
    placed.push({ ...e, x: hit.x, y: hit.y });
  });
  return { size, placed, dropped, anchors };
}

/**
 * 区域 → 画布面板。三种形态：
 *   - single：只有一个区域 → 一块铺满整帧。
 *   - insets：主区域占比 ≥ dominantShare（一家独大）→ 主面板铺满 + 其余区域贴边小格。
 *   - grid  ：多城/分散 → 首行主区域通栏、其余按两列网格铺，每块都是该区域的真实地图，
 *             因此「轨迹分散时海报全是碎屑小格」不会再出现；面板总数封顶 maxPanels，超出只报数。
 * 三种形态都保证：面板互不相交、全部落在 frame 内。
 */
function layoutRegions(groups, frame, opts) {
  const list = (Array.isArray(groups) ? groups : []).filter((g) => g && g.bbox);
  const gap = opts && opts.gap != null ? opts.gap : 8;
  const insetSize = (opts && opts.insetSize) || 46;
  const maxPanels = (opts && opts.maxPanels) || 4;
  const dominantShare = opts && opts.dominantShare != null ? opts.dominantShare : 0.55;

  if (!list.length) return { mode: 'single', panels: [], dropped: 0 };

  const keep = list.slice(0, Math.max(1, maxPanels));
  const droppedRegions = list.length - keep.length;

  if (keep.length === 1) {
    return { mode: 'single', panels: [{ group: keep[0], rect: { ...frame }, bordered: false }], dropped: droppedRegions };
  }

  const totalPoints = keep.reduce((s, g) => s + (g.points || 0), 0) || 1;
  const mainShare = (keep[0].points || 0) / totalPoints;

  if (mainShare >= dominantShare) {
    const { main, extras } = splitGroups(keep);
    const edge = layoutEdgeBoxes(extras, { frame, size: insetSize });
    const panels = [{ group: main, rect: { ...frame }, bordered: false }];
    edge.placed.forEach((slot) => {
      panels.push({
        group: slot,
        bordered: true,
        rect: {
          left: slot.x - insetSize / 2,
          right: slot.x + insetSize / 2,
          top: slot.y - insetSize / 2,
          bottom: slot.y + insetSize / 2,
        },
      });
    });
    return { mode: 'insets', panels, dropped: droppedRegions + edge.dropped.length };
  }

  // 网格：每行两块；数量为奇数时首行留给主区域通栏（避免末行空半边）
  const rows = [];
  let idx = 0;
  if (keep.length % 2 === 1) {
    rows.push([keep[0]]);
    idx = 1;
  }
  while (idx < keep.length) {
    rows.push(keep.slice(idx, idx + 2));
    idx += 2;
  }

  const rowH = (frame.bottom - frame.top - gap * (rows.length - 1)) / rows.length;
  const panels = [];
  rows.forEach((rowGroups, r) => {
    const top = frame.top + r * (rowH + gap);
    const cellW = (frame.right - frame.left - gap * (rowGroups.length - 1)) / rowGroups.length;
    rowGroups.forEach((g, c) => {
      const left = frame.left + c * (cellW + gap);
      panels.push({ group: g, bordered: true, rect: { left, right: left + cellW, top, bottom: top + rowH } });
    });
  });
  return { mode: 'grid', panels, dropped: droppedRegions };
}

/** 把 bbox 围绕中心撑到至少 minKm（两个方向都撑），但不超出 allow 的范围 */
function expandToMinSpan(bbox, allow, minKm) {
  const cLat = (bbox.minLat + bbox.maxLat) / 2;
  const cLng = (bbox.minLng + bbox.maxLng) / 2;
  const kLng = kmPerDegLng(cLat) || DEG_LAT_KM;
  const latSpan = Math.min(minKm / DEG_LAT_KM, allow.maxLat - allow.minLat);
  const lngSpan = Math.min(minKm / kLng, allow.maxLng - allow.minLng);
  return {
    minLat: Math.min(bbox.minLat, cLat - latSpan / 2),
    maxLat: Math.max(bbox.maxLat, cLat + latSpan / 2),
    minLng: Math.min(bbox.minLng, cLng - lngSpan / 2),
    maxLng: Math.max(bbox.maxLng, cLng + lngSpan / 2),
  };
}

/** bbox 的「跨度代价」（km）：纬度跨度 + 经度跨度（经度按中心纬度折算） */
function spanKm(bbox) {
  const kLng = kmPerDegLng((bbox.minLat + bbox.maxLat) / 2) || DEG_LAT_KM;
  return (bbox.maxLat - bbox.minLat) * DEG_LAT_KM + (bbox.maxLng - bbox.minLng) * kLng;
}

/**
 * 区域内的「核心活动区」bbox：每次挑「新增活动量（采样点数）/ 被撑大的跨度」最高的那条轨迹
 * 累进来，直到覆盖 keepShare 的活动量；核心外的轨迹仍按真实相对位置画、超出画布被裁掉，
 * 因此少数远途轨迹不会把小图的主角拉散。
 *
 * 为什么按「性价比」而不是「由近到远」：真实数据（全部档主组）里 7.4km 外有一条只有 4 个点的
 * 碎片、8.2km 外才是 64 个点的活动团；按距离排队会先吃碎片、白白把主图撑宽 7.5km
 * （实测核心 18.0km→13.2km 宽，主图缩放 14.9→20.3 px/km）。
 * 为什么按「轨迹」而不是「点密度」：原地录制的停留轨迹把点堆在一个 150m 格子里
 * （实测 21 条里 10 条共享 595/734 个点），点密度核心只有 0.2×0.16km，会把主图钉死在那个停留点上。
 * 核心过小时再围绕核心中心撑到 minKm，但撑开范围不超出整区（整区本身就这么小就原样返回）。
 */
function coreBbox(items, opts) {
  const keepShare = opts && opts.keepShare != null ? opts.keepShare : 0.9;
  const minKm = (opts && opts.minKm) || 1.2;

  const list = [];
  (items || []).forEach((it) => {
    const pts = ((it && it.track && it.track.points) || []).filter(
      (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng),
    );
    if (!pts.length) return;
    const bbox = unionBbox(pts.map((p) => ({ minLat: p.lat, maxLat: p.lat, minLng: p.lng, maxLng: p.lng })));
    list.push({
      bbox,
      count: pts.length,
      centerLat: (bbox.minLat + bbox.maxLat) / 2,
      centerLng: (bbox.minLng + bbox.maxLng) / 2,
    });
  });
  if (!list.length) return null;

  const full = unionBbox(list.map((x) => x.bbox));
  let need = 0;
  list.forEach((x) => {
    need += x.count;
  });
  need *= keepShare;

  const rest = list.slice();
  let core = null;
  let acc = 0;
  while (rest.length && acc < need) {
    let pick = -1;
    let bestRatio = -Infinity;
    for (let i = 0; i < rest.length; i++) {
      const cand = unionBbox(core ? [core, rest[i].bbox] : [rest[i].bbox]);
      // 单点轨迹的跨度是 0：兜住除零，否则它会拿到无穷大的性价比、抢先占掉主图
      const gain = Math.max(spanKm(cand) - (core ? spanKm(core) : 0), MIN_SPAN_KM);
      const ratio = rest[i].count / gain;
      if (ratio > bestRatio) {
        bestRatio = ratio;
        pick = i;
      }
    }
    core = unionBbox(core ? [core, rest[pick].bbox] : [rest[pick].bbox]);
    acc += rest[pick].count;
    rest.splice(pick, 1);
  }

  return expandToMinSpan(core, full, minKm);
}

/**
 * 区域 bbox → 画布投影参数：按真实公里数等比缩放（经度已按中心纬度折算），
 * 取横纵比例里更小的那个，因此该区域必然完整落在 frame 内、且不变形。
 */
function fitScale(bbox, frame) {
  const midLat = (bbox.minLat + bbox.maxLat) / 2;
  const midLng = (bbox.minLng + bbox.maxLng) / 2;
  const kLng = kmPerDegLng(midLat) || DEG_LAT_KM;
  const latKm = Math.max((bbox.maxLat - bbox.minLat) * DEG_LAT_KM, MIN_SPAN_KM);
  const lngKm = Math.max((bbox.maxLng - bbox.minLng) * kLng, MIN_SPAN_KM);
  const w = frame.right - frame.left;
  const h = frame.bottom - frame.top;
  return {
    scale: Math.min(w / lngKm, h / latKm),
    midLat,
    midLng,
    kmPerDegLng: kLng,
  };
}

/** 区域 bbox + frame → 经纬度到画布坐标的投影器（主图与贴边小格共用同一套口径） */
function makeProjector(bbox, frame) {
  const fit = fitScale(bbox, frame);
  const cx = (frame.left + frame.right) / 2;
  const cy = (frame.top + frame.bottom) / 2;
  return {
    fit,
    x: (lng) => cx + (lng - fit.midLng) * fit.kmPerDegLng * fit.scale,
    y: (lat) => cy - (lat - fit.midLat) * DEG_LAT_KM * fit.scale,
  };
}

module.exports = {
  groupTracks,
  splitGroups,
  layoutEdgeBoxes,
  layoutRegions,
  coreBbox,
  fitScale,
  makeProjector,
  trackBbox,
  kmPerDegLng,
  EDGE_ANCHORS,
  DEFAULT_GROUP_KM,
  MIN_SPAN_KM,
};

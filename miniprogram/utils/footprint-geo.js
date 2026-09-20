/**
 * 足迹地图几何纯计算（无 wx 依赖，可 node --test 直测）
 * - Web 墨卡托投影：256px 基准，zoom 直接用 map 的 scale 值
 * - fitBounds：由点集算 center+scale。不用 include-points 的原因（官方文档查证，见 docs/11 §4.2）：
 *   include-points 形状是 Array<{latitude,longitude}>，没有 padding 可用（点会贴边被裁一半），
 *   且单点包围盒零面积会把 scale 顶到 20 —— components/track-map 里已踩过同一个坑
 * - gridCluster：按当前 zoom 切屏幕格子给点分桶。原生聚合（initMarkerCluster）下用于
 *   判定哪些点 joinCluster、以及最大缩放簇拆不开时的成员列表兜底
 */

/** 聚合格子屏幕边长（px）。越大越容易并成簇 */
const GRID_PX = 56;
/** fitBounds 上限：多点也不顶到 20（顶满后密集区会糊成一团）；单点固定层级 */
const FIT_MAX_SCALE = 15;
const FIT_SINGLE_SCALE = 12;
/** map scale 取值区间下限（文档 scale: 3~20） */
const MIN_SCALE = 3;
/** 视野内边距（CSS px）：底部留出 FAB 与弹窗空间 */
const FIT_PAD_X = 40;
const FIT_PAD_TOP = 50;
const FIT_PAD_BOTTOM = 120;

/** 墨卡托世界像素（zoom 0，256px 基准）；某 zoom 下的像素 = 世界像素 * 2^zoom */
function lngToWorldX(lng) {
  return (256 * (lng + 180)) / 360;
}
function latToWorldY(lat) {
  const s = Math.sin((Math.max(-85.05112, Math.min(85.05112, lat)) * Math.PI) / 180);
  return 256 * (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI));
}
function worldYToLat(y) {
  const t = Math.tanh(Math.PI * (1 - (2 * y) / 256));
  return (Math.asin(Math.max(-1, Math.min(1, t))) * 180) / Math.PI;
}

/** 墨卡托投影：经纬度 → 该 zoom 下的世界像素坐标（zoom 直接用 map 的 scale 值） */
function projectLng(lng, zoom) {
  return lngToWorldX(lng) * Math.pow(2, zoom);
}
function projectLat(lat, zoom) {
  return latToWorldY(lat) * Math.pow(2, zoom);
}

/**
 * 手动 fitBounds 算视野。
 * @param {Array<{latitude:number,longitude:number}>} points 非空点集
 * @param {{width:number,height:number}} viewport 地图可视区（CSS px），调用方从窗口信息算好传入
 * @returns {{center:{latitude:number,longitude:number},scale:number}}
 */
function fitBounds(points, viewport) {
  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;
  points.forEach((p) => {
    minLat = Math.min(minLat, p.latitude);
    maxLat = Math.max(maxLat, p.latitude);
    minLng = Math.min(minLng, p.longitude);
    maxLng = Math.max(maxLng, p.longitude);
  });
  // 单点/零面积包围盒：固定层级直接定位到点（顶满 scale 的老坑）
  if (points.length === 1 || (minLat === maxLat && minLng === maxLng)) {
    return { center: { latitude: points[0].latitude, longitude: points[0].longitude }, scale: FIT_SINGLE_SCALE };
  }
  const view = viewport || { width: 375, height: 600 };
  const usableW = Math.max(80, view.width - FIT_PAD_X * 2);
  const usableH = Math.max(80, view.height - FIT_PAD_TOP - FIT_PAD_BOTTOM);
  const center = {
    latitude: worldYToLat((latToWorldY(minLat) + latToWorldY(maxLat)) / 2),
    longitude: (minLng + maxLng) / 2,
  };
  const spanX = lngToWorldX(maxLng) - lngToWorldX(minLng);
  const spanY = latToWorldY(minLat) - latToWorldY(maxLat);
  const z = Math.min(Math.log2(usableW / spanX), Math.log2(usableH / spanY));
  let scale = Number.isFinite(z) ? Math.floor(z) : FIT_MAX_SCALE;
  scale = Math.max(MIN_SCALE, Math.min(FIT_MAX_SCALE, scale));
  return { center, scale };
}

/**
 * 网格聚合：同一格（GRID_PX 见方）内的点并成一簇，簇心取成员均值。
 * @param {Array<{index:number,latitude:number,longitude:number}>} points index = records 下标
 * @param {number} zoom 当前 map scale
 */
function gridCluster(points, zoom) {
  const cells = {};
  const order = [];
  points.forEach((p) => {
    const gx = Math.floor(projectLng(p.longitude, zoom) / GRID_PX);
    const gy = Math.floor(projectLat(p.latitude, zoom) / GRID_PX);
    const key = gx + ':' + gy;
    if (!cells[key]) {
      cells[key] = [];
      order.push(key);
    }
    cells[key].push(p);
  });
  return order.map((key) => {
    const members = cells[key];
    let lat = 0;
    let lng = 0;
    members.forEach((m) => {
      lat += m.latitude;
      lng += m.longitude;
    });
    return {
      count: members.length,
      latitude: lat / members.length,
      longitude: lng / members.length,
      // 成员在 records 中的下标（最大缩放簇拆不开时开成员列表用）
      members: members.map((m) => m.index),
      // 单点簇保留 records 下标，弹窗按它取数据
      recordIndex: members.length === 1 ? members[0].index : -1,
    };
  });
}

module.exports = {
  GRID_PX,
  FIT_MAX_SCALE,
  FIT_SINGLE_SCALE,
  MIN_SCALE,
  lngToWorldX,
  latToWorldY,
  worldYToLat,
  projectLng,
  projectLat,
  fitBounds,
  gridCluster,
};

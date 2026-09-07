/**
 * GeoJSON → canvas 2d 轻量地图渲染（运动榜用；避免把 494KB echarts 移入主包）
 * - 等经纬投影（纬度按中点余弦修正，与轨迹绘制口径一致）
 * - 按 value 上色（点亮深浅），未点亮灰
 * - 返回命中检测函数（同一投影坐标系做射线法点-in-多边形）
 */

/** 经纬度范围 → 画布投影函数 */function makeProjector(features, width, height, pad) {
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  const eachPoint = (cb) => {
    for (const f of features) {
      const geom = f.geometry;
      if (!geom) continue;
      const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
      for (const poly of polys) for (const ring of poly) for (const [lng, lat] of ring) cb(lng, lat);
    }
  };
  eachPoint((lng, lat) => {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  });
  const midLat = (minLat + maxLat) / 2;
  const kLng = Math.cos((midLat * Math.PI) / 180); // 经度视觉压缩
  const w = (maxLng - minLng) * kLng;
  const h = maxLat - minLat;
  const scale = Math.min((width - pad * 2) / (w || 1e-9), (height - pad * 2) / (h || 1e-9));
  const offX = (width - w * scale) / 2;
  const offY = (height - h * scale) / 2;
  return (lng, lat) => [offX + (lng - minLng) * kLng * scale, offY + (maxLat - lat) * scale];
}

/** 射线法：点是否在环内 */
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * 在 canvas 上绘制 GeoJSON 地图
 * @param {object} opts { geojson, valueOf(name)→number|undefined, colorFor(name, value)→fillColor,
 *                       unlitColor, borderColor, pad }
 * @returns {{ hitTest(x, y): string|null }} 点击命中（返回 feature name）
 */
function drawGeoMap(ctx, width, height, opts) {
  const { geojson, valueOf, colorFor, unlitColor = '#eef1f5', borderColor = '#c8d0dc', pad = 8 } = opts;
  const features = (geojson && geojson.features) || [];
  const project = makeProjector(features, width, height, pad);

  ctx.clearRect(0, 0, width, height);
  const polys = [];
  for (const f of features) {
    const name = (f.properties && f.properties.name) || '';
    const geom = f.geometry;
    if (!geom || !name) continue;
    const ringsSet = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    const value = valueOf ? valueOf(name) : undefined;
    ctx.beginPath();
    const screenRings = [];
    for (const poly of ringsSet) {
      for (const ring of poly) {
        const sr = ring.map(([lng, lat]) => project(lng, lat));
        screenRings.push(sr);
        sr.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.closePath();
      }
    }
    ctx.fillStyle = value ? colorFor(name, value) : unlitColor;
    ctx.fill('evenodd');
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 0.5;
    ctx.stroke();
    polys.push({ name, rings: screenRings });
  }

  return {
    hitTest(x, y) {
      for (const p of polys) {
        // 外环命中 + 内环（岛屿洞）排除
        const [outer, ...holes] = p.rings;
        if (outer && pointInRing(x, y, outer) && !holes.some((h) => pointInRing(x, y, h))) {
          return p.name;
        }
      }
      return null;
    },
  };
}

module.exports = drawGeoMap;

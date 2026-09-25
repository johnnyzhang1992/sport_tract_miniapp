/**
 * 聚合分享海报几何纯函数（utils/poster-aggregate.js）单测。
 * 为什么要测：聚合模式原先「密集区放大到 70% + 其余轨迹按方位摆到同一半径圆环」，
 * 实测全部档 45 条里 37 条外围全挤成一圈互相重叠（2026-09-25 现场）；而且用户数据是跨城的
 * （武汉 ~25 条 / 上海 ~20 条 / 深圳 1 条），点级分位会被远端城市里点多的一条轨迹撑破。
 * 改版后按「区域」分组：主区域（轨迹最多的那一簇）按真实经纬度等比铺满画布，
 * 其余远端区域各缩成一张贴边小格——这里的分组、等比投影、贴边落位三道纯函数就是全部保证。
 * 运行：npm test（node --test 自动发现）；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  groupTracks,
  splitGroups,
  layoutEdgeBoxes,
  layoutRegions,
  coreBbox,
  fitScale,
  makeProjector,
} = require('../miniprogram/utils/poster-aggregate.js');

/** 聚合海报地图区（与 overview.js 里 W300/H400/pad16/mapTop82/mapBottom360 一致） */
const FRAME = { left: 16, right: 284, top: 82, bottom: 360 };
const EDGE = { frame: FRAME, size: 46 };

/** 一条轨迹：以 (lat,lng) 为中心、±span 的十字四点（bbox 中心恰为给定点） */
function track(lat, lng, span) {
  const s = span == null ? 0.004 : span;
  return { points: [{ lat: lat - s, lng }, { lat: lat + s, lng }, { lat, lng: lng - s }, { lat, lng: lng + s }] };
}

/** 一组 item 的并集 bbox（测试用，与实现口径无关） */
function unionOf(items) {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  items.forEach((it) => it.track.points.forEach((p) => {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }));
  return { minLat, maxLat, minLng, maxLng };
}

/** 两条方框是否相交（间距 gap 也要留出来） */
function collide(a, b, size, gap) {
  return Math.abs(a.x - b.x) < size + gap && Math.abs(a.y - b.y) < size + gap;
}

/* -------------------------------- groupTracks ------------------------------- */

test('PG1 区域分组：同城并成一组、远端城市各自成组，主组（采样点最多）排第一', () => {
  const tracks = [
    track(30.5, 114.42), track(30.505, 114.425), track(30.495, 114.415), // 武汉 3 条
    track(31.23, 121.47), track(31.235, 121.475), // 上海 2 条
    track(22.55, 113.94), // 深圳 1 条
  ];
  const groups = groupTracks(tracks, { groupKm: 30 });
  assert.equal(groups.length, 3);
  assert.equal(groups[0].count, 3, '主组应是武汉那 3 条');
  assert.equal(groups[1].count, 2);
  assert.equal(groups[2].count, 1);
  assert.deepEqual(groups[0].items.map((i) => i.index).sort(), [0, 1, 2]);
});

test('PG2 区域分组：30km 阈值内并入、阈值外独立成组', () => {
  const near = 30.5 + 0.26 / 1, far = 30.5 + 0.28;
  const nearKm = (near - 30.5) * 111;
  const farKm = (far - 30.5) * 111;
  assert.ok(nearKm < 30 && farKm > 30, `夹具本身要卡在阈值两侧：${nearKm.toFixed(1)} / ${farKm.toFixed(1)}`);

  const merged = groupTracks([track(30.5, 114.4), track(30.5, 114.4), track(near, 114.4)], { groupKm: 30 });
  assert.equal(merged.length, 1, `${nearKm.toFixed(1)}km 应并入主组`);

  const split = groupTracks([track(30.5, 114.4), track(30.5, 114.4), track(far, 114.4)], { groupKm: 30 });
  assert.equal(split.length, 2, `${farKm.toFixed(1)}km 应独立成组`);
  assert.equal(split[0].count, 2, '主组仍是武汉那 2 条');
});

test('PG3 区域分组：主组 bbox 不会被远端城市撑大，远端轨迹不计入主组点数', () => {
  const tracks = [track(30.5, 114.42), track(30.505, 114.425), track(31.23, 121.47)];
  const groups = groupTracks(tracks, { groupKm: 30 });
  const main = groups[0];
  assert.ok(main.bbox.maxLat < 30.6, `主组 bbox 不该含上海，实际 maxLat=${main.bbox.maxLat}`);
  assert.ok(main.bbox.maxLng < 114.5, `主组 bbox 不该含上海，实际 maxLng=${main.bbox.maxLng}`);
  assert.equal(main.points, 8, '主组点数=2 条 × 4 点');
});

test('PG3b 主区域按采样点数定：出差城市条数多但家里点多，主图仍是家里', () => {
  // 家里 2 条长轨迹（各 10 点），出差城市 3 条碎轨迹（各 2 点）
  const home = [0, 1].map((i) => ({ points: Array.from({ length: 10 }, (_, k) => ({ lat: 30.5 + k * 0.001, lng: 114.4 + i * 0.01 })) }));
  const trip = [0, 1, 2].map((i) => ({ points: [{ lat: 31.2 + i * 0.01, lng: 121.4 }, { lat: 31.21 + i * 0.01, lng: 121.41 }] }));
  const groups = groupTracks([...home, ...trip], { groupKm: 30 });
  assert.equal(groups.length, 2);
  assert.equal(groups[0].count, 2, '主组应是家里那 2 条（点数 20 > 6）');
  assert.equal(groups[0].points, 20);
  assert.equal(groups[1].count, 3);
});

test('PG4 区域分组：无有效点的轨迹被跳过；空输入返回空数组', () => {
  assert.deepEqual(groupTracks([], { groupKm: 30 }), []);
  const groups = groupTracks([{ points: [] }, { points: [{ lat: NaN, lng: 1 }] }, track(30.5, 114.4)], { groupKm: 30 });
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].items.map((i) => i.index), [2]);
});

test('PG5 远端区域方位：相对主组中心给真实方位角（正东 0、正北 π/2）', () => {
  const groups = groupTracks(
    [track(30.5, 114.4), track(30.5, 114.4), track(30.5, 115.4), track(31.5, 114.4)],
    { groupKm: 30 },
  );
  const { main, extras } = splitGroups(groups);
  assert.equal(main.count, 2);
  assert.equal(extras.length, 2);
  const east = extras.find((e) => e.centerLng > 115);
  const north = extras.find((e) => e.centerLat > 31);
  assert.ok(Math.abs(east.bearing) < 1e-3, `正东方位应为 0，实际 ${east.bearing}`);
  assert.ok(Math.abs(north.bearing - Math.PI / 2) < 1e-3, `正北方位应为 π/2，实际 ${north.bearing}`);
});

/* ----------------------------- layoutEdgeBoxes ------------------------------ */

test('PG6 贴边落位：按真实方位就近平移（正东→右中、正北→上中）', () => {
  const cx = (FRAME.left + FRAME.right) / 2;
  const cy = (FRAME.top + FRAME.bottom) / 2;

  const east = layoutEdgeBoxes([{ bearing: 0 }], EDGE);
  assert.equal(east.placed.length, 1);
  assert.ok(east.placed[0].x > cx && Math.abs(east.placed[0].y - cy) < 1e-6, '正东应落在右中');

  const north = layoutEdgeBoxes([{ bearing: Math.PI / 2 }], EDGE);
  assert.ok(Math.abs(north.placed[0].x - cx) < 1e-6 && north.placed[0].y < cy, '正北应落在上中');
});

test('PG7 贴边落位：全部同方位也能各自落位，两两不重叠且不出画布', () => {
  const extras = [];
  for (let i = 0; i < 8; i++) extras.push({ bearing: 0, tag: i });
  const { placed, dropped } = layoutEdgeBoxes(extras, EDGE);

  assert.equal(dropped.length, 0, '8 个方位锚点应能放下 8 个远端区域');
  assert.equal(placed.length, 8);
  for (const p of placed) {
    assert.ok(p.x - 23 >= FRAME.left - 1e-6 && p.x + 23 <= FRAME.right + 1e-6, `小格出画布左右：x=${p.x}`);
    assert.ok(p.y - 23 >= FRAME.top - 1e-6 && p.y + 23 <= FRAME.bottom + 1e-6, `小格出画布上下：y=${p.y}`);
  }
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      assert.ok(!collide(placed[i], placed[j], 46, 8), `小格 ${i} 与 ${j} 重叠`);
    }
  }
});

test('PG8 贴边落位：画布小到锚点会互相撞时，靠碰撞检测只落一个、其余 dropped', () => {
  const tinyFrame = { left: 0, right: 80, top: 0, bottom: 80 };
  const extras = [];
  for (let i = 0; i < 8; i++) extras.push({ bearing: 0 });
  const { placed, dropped } = layoutEdgeBoxes(extras, { frame: tinyFrame, size: 46 });

  assert.equal(placed.length, 1, `锚点间距只有 ${(2 * 11 * Math.sin(Math.PI / 8)).toFixed(1)}px、放不下 46px 方框`);
  assert.equal(dropped.length, 7);
  assert.ok(placed[0].x - 23 >= tinyFrame.left && placed[0].x + 23 <= tinyFrame.right, '落下的那个也不能出画布');
  assert.ok(placed[0].y - 23 >= tinyFrame.top && placed[0].y + 23 <= tinyFrame.bottom, '落下的那个也不能出画布');
});

test('PG9 贴边落位：超出锚点数按方位顺序截断并回报 dropped', () => {
  const extras = [];
  for (let i = 0; i < 11; i++) extras.push({ bearing: (i / 11) * Math.PI * 2, tag: i });
  const { placed, dropped } = layoutEdgeBoxes(extras, EDGE);
  assert.equal(placed.length + dropped.length, 11);
  assert.ok(dropped.length >= 3, `锚点只有 8 个，至少丢 3 个，实际 ${dropped.length}`);
});

/* --------------------------------- 等比投影 --------------------------------- */

test('PG10 等比投影：主区域四角落在 frame 内，且贴合受限的那一边（不拉伸）', () => {
  const bbox = { minLat: 30.4, maxLat: 30.42, minLng: 114.2, maxLng: 114.24 };
  const p = makeProjector(bbox, FRAME);
  const fit = fitScale(bbox, FRAME);

  assert.ok(p.x(bbox.minLng) >= FRAME.left - 1e-6 && p.x(bbox.maxLng) <= FRAME.right + 1e-6);
  assert.ok(p.y(bbox.minLat) <= FRAME.bottom + 1e-6 && p.y(bbox.maxLat) >= FRAME.top - 1e-6);

  const projW = p.x(bbox.maxLng) - p.x(bbox.minLng);
  const projH = p.y(bbox.minLat) - p.y(bbox.maxLat);
  const frameW = FRAME.right - FRAME.left;
  const frameH = FRAME.bottom - FRAME.top;
  // 经向跨 0.04°（纬度 30.4 处约 3.8km）、纬向跨 0.02°（2.2km）→ 宽度方向受限
  assert.ok(Math.abs(projW - frameW) < 0.5, `受限方向应贴满：${projW} vs ${frameW}`);
  assert.ok(projH < frameH, '非受限方向应留白，不能被拉满');
  assert.ok(Math.abs(fit.kmPerDegLng - 111 * Math.cos((fit.midLat * Math.PI) / 180)) < 1e-9);
  assert.ok(Math.abs(projW / (0.04 * fit.kmPerDegLng) - projH / (0.02 * 111)) < 1e-6, '横纵像素/公里必须相等');
});

test('PG11 等比投影：退化为单点时不产生 NaN/Infinity', () => {
  const bbox = { minLat: 30.5, maxLat: 30.5, minLng: 114.4, maxLng: 114.4 };
  const p = makeProjector(bbox, FRAME);
  assert.ok(Number.isFinite(p.x(114.4)) && Number.isFinite(p.y(30.5)));
  assert.ok(Number.isFinite(fitScale(bbox, FRAME).scale));
});

/* ------------------------------- layoutRegions ------------------------------ */
/** 两个矩形是否相交（相切不算） */
function rectHit(a, b) {
  return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
}
/** 造一个组：n 条轨迹、每条 pts 个点，落在 (lat,lng) 附近 */
function groupAt(lat, lng, n, pts) {
  const tracks = [];
  for (let i = 0; i < n; i++) {
    const points = [];
    for (let k = 0; k < pts; k++) points.push({ lat: lat + k * 0.001, lng: lng + (i % 3) * 0.001 });
    tracks.push({ points });
  }
  return groupTracks(tracks, { groupKm: 30 })[0];
}

test('RL1 单区域：一块面板铺满整帧，不做分块', () => {
  const groups = [groupAt(30.5, 114.4, 3, 10)];
  const out = layoutRegions(groups, FRAME);
  assert.equal(out.mode, 'single');
  assert.equal(out.panels.length, 1);
  assert.deepEqual(out.panels[0].rect, FRAME);
  assert.equal(out.dropped, 0);
});

test('RL2 一家独大（主区域占比 ≥55%）：主面板铺满 + 其余贴边小格', () => {
  const main = groupAt(30.5, 114.4, 5, 40); // 200 点
  const far = groupAt(31.2, 121.5, 1, 8); // 8 点 → 占比 3.8%
  const out = layoutRegions([main, far], FRAME, { insetSize: 46 });
  assert.equal(out.mode, 'insets');
  assert.equal(out.panels.length, 2);
  assert.deepEqual(out.panels[0].rect, FRAME, '主区域应铺满整帧');
  assert.equal(Math.round(out.panels[1].rect.right - out.panels[1].rect.left), 46, '远端区域是 46px 小格');
});

test('RL3 两城均衡：左右两块等分，都在帧内且不相交', () => {
  const a = groupAt(30.5, 114.4, 3, 10);
  const b = groupAt(31.2, 121.5, 3, 10);
  const out = layoutRegions([a, b], FRAME, { gap: 8 });
  assert.equal(out.mode, 'grid');
  assert.equal(out.panels.length, 2);
  out.panels.forEach((p) => {
    assert.ok(p.rect.left >= FRAME.left - 1e-6 && p.rect.right <= FRAME.right + 1e-6, '面板出帧左右');
    assert.ok(p.rect.top >= FRAME.top - 1e-6 && p.rect.bottom <= FRAME.bottom + 1e-6, '面板出帧上下');
  });
  assert.ok(!rectHit(out.panels[0].rect, out.panels[1].rect), '两块面板不能相交');
});

test('RL4 三区域：首行主面板通栏、次行两块并排；全都不相交且在帧内', () => {
  const gs = [groupAt(30.5, 114.4, 3, 10), groupAt(31.2, 121.5, 3, 10), groupAt(22.5, 113.9, 3, 10)];
  const out = layoutRegions(gs, FRAME, { gap: 8 });
  assert.equal(out.mode, 'grid');
  assert.equal(out.panels.length, 3);
  const [p0, p1, p2] = out.panels.map((p) => p.rect);
  assert.equal(Math.round(p0.left), FRAME.left, '首块通栏左对齐');
  assert.equal(Math.round(p0.right), FRAME.right, '首块通栏右对齐');
  assert.ok(p1.right <= p2.left + 1e-6 || p2.right <= p1.left + 1e-6, '次行两块左右并排');
  for (let i = 0; i < out.panels.length; i++) {
    for (let j = i + 1; j < out.panels.length; j++) {
      assert.ok(!rectHit(out.panels[i].rect, out.panels[j].rect), `面板 ${i} 与 ${j} 相交`);
    }
  }
});

test('RL5 分散多区域：面板数封顶，其余只计数（不出现碎屑小格）', () => {
  const gs = [];
  for (let i = 0; i < 8; i++) gs.push(groupAt(20 + i * 2, 100 + i * 3, 2, 10));
  const out = layoutRegions(gs, FRAME, { maxPanels: 4, gap: 8 });
  assert.equal(out.panels.length, 4);
  assert.equal(out.dropped, 4, '8 个区域只画 4 块，其余报数');
  assert.equal(out.mode, 'grid');
});

test('RL6 通用不变式：任何区域数下面板都互不相交、都在帧内', () => {
  for (let n = 1; n <= 8; n++) {
    const gs = [];
    for (let i = 0; i < n; i++) gs.push(groupAt(20 + i * 2, 100 + i * 3, 2, 10));
    const out = layoutRegions(gs, FRAME, { gap: 8, insetSize: 46 });
    for (const p of out.panels) {
      assert.ok(p.rect.left >= FRAME.left - 1e-6 && p.rect.right <= FRAME.right + 1e-6, `n=${n} 面板出帧左右`);
      assert.ok(p.rect.top >= FRAME.top - 1e-6 && p.rect.bottom <= FRAME.bottom + 1e-6, `n=${n} 面板出帧上下`);
      assert.ok(p.rect.right - p.rect.left > 20 && p.rect.bottom - p.rect.top > 20, `n=${n} 面板过小`);
    }
    for (let i = 0; i < out.panels.length; i++) {
      for (let j = i + 1; j < out.panels.length; j++) {
        assert.ok(!rectHit(out.panels[i].rect, out.panels[j].rect), `n=${n} 面板 ${i}/${j} 相交`);
      }
    }
  }
});

/* --------------------------------- coreBbox --------------------------------- */
/**
 * 核心活动区：主图不按整组 bbox 铺满，而是按「核心活动区」铺满，组内离核心远的轨迹
 * 仍按真实位置画、超出画布被裁掉——这是用户选的「主图放大密集核心」口径。
 *
 * 怎么选核心：每次挑「新增活动量(采样点数) / 被撑大的跨度(km)」最高的那条轨迹累进来，
 * 直到覆盖 keepShare 的活动量。为什么要比值而不是「由近到远」：真实数据（全部档主组）里
 * 有一条 7.4km 外只有 4 个点的碎片，它比 8.2km 外 64 个点的活动团更近；按距离排队会先把
 * 碎片吃进来、把主图白白撑宽 7.5km。按性价比选就不会为 4 个点付 7.5km 的代价。
 *
 * 为什么按「轨迹」而不是按「点密度」：原地录制的停留轨迹会把点堆在一个 150m 格子里
 * （实测 21 条里 10 条共享 595/734 个点），按点密度算出来的核心只有 0.2×0.16km，
 * 会把主图钉死在那个停留点上、其余 11 条轨迹全被裁掉。
 */
test('CB1 核心区：少数远途轨迹被排除，核心跨度明显小于整组', () => {
  const items = [];
  for (let i = 0; i < 20; i++) {
    const points = [];
    for (let k = 0; k < 10; k++) points.push({ lat: 30.5 + k * 0.0002, lng: 114.4 + i * 0.0002 });
    items.push({ track: { points } });
  }
  const far = { lat: 30.32, lng: 114.3 };
  items.push({ track: { points: Array.from({ length: 10 }, (_, k) => ({ lat: far.lat + k * 0.0002, lng: far.lng })) } });

  const full = unionOf(items);
  const core = coreBbox(items);
  assert.ok(core.maxLat < 30.6, `核心不该含 20km 外那条，实际 ${core.maxLat}`);
  assert.ok((core.maxLat - core.minLat) * 111 < (full.maxLat - full.minLat) * 111 / 5, '核心纬度跨度应远小于整组');
});

test('CB2 核心区下限：核心只有几十米时撑到最小 1.2km，但不超出整组范围', () => {
  // 一条原地录制（几十米内 100 点）+ 一条 9km 外的两点轨迹（既提供扩开空间、又验证裁剪）
  const dense = [];
  for (let k = 0; k < 100; k++) dense.push({ lat: 30.5 + (k % 10) * 0.00005, lng: 114.4 + Math.floor(k / 10) * 0.00005 });
  const items = [
    { track: { points: dense } },
    { track: { points: [{ lat: 30.58, lng: 114.48 }, { lat: 30.59, lng: 114.49 }] } },
  ];

  const full = unionOf(items);
  const core = coreBbox(items, { minKm: 1.2 });
  const latKm = (core.maxLat - core.minLat) * 111;
  const lngKm = (core.maxLng - core.minLng) * 111 * Math.cos(30.5 * Math.PI / 180);
  assert.ok(latKm >= 1.15 && latKm <= 1.3, `核心纬度跨度应撑到约 1.2km，实际 ${latKm.toFixed(2)}`);
  assert.ok(lngKm >= 1.15 && lngKm <= 1.3, `核心经度跨度应撑到约 1.2km，实际 ${lngKm.toFixed(2)}`);
  // 撑到最小跨度是"围绕核心中心对称撑"，允许略微超出整组范围（只多出边距、核心仍是画面中心）
  const slack = 1.2 / 111;
  assert.ok(core.maxLat <= full.maxLat + slack && core.minLat >= full.minLat - slack, '超出整组范围不能多于最小跨度');
});

test('CB3 核心区：不为近处的小碎片付跨度代价——取远处成团的活动，舍近处 1 点的碎片', () => {
  // 停留热点 100 点；西边 7.5km 外两个 1 点的碎片（更近）；北边 8km 外 3 条各 20 点的成团活动
  const blob = [];
  for (let k = 0; k < 100; k++) blob.push({ lat: 30.5 + (k % 10) * 0.00005, lng: 114.4 + Math.floor(k / 10) * 0.00005 });
  const items = [{ track: { points: blob } }];
  for (let i = 0; i < 3; i++) {
    const points = [];
    for (let k = 0; k < 20; k++) points.push({ lat: 30.572 + k * 0.00002, lng: 114.4 + i * 0.00002 });
    items.push({ track: { points } });
  }
  items.push({ track: { points: [{ lat: 30.5, lng: 114.325 }] } });
  items.push({ track: { points: [{ lat: 30.5, lng: 114.3255 }] } });

  const core = coreBbox(items);
  assert.ok(core.minLng > 114.39, `核心不该被 7.5km 外的两个单点碎片拉到西边，实际 minLng=${core.minLng}`);
  assert.ok(core.maxLat >= 30.572 - 1e-9, `核心该含 8km 外的成团活动，实际 maxLat=${core.maxLat}`);
});

test('CB5 核心区：轨迹均匀分散（权重相当）时几乎不放大，核心覆盖整组跨度', () => {
  const items = [];
  for (let i = 0; i < 10; i++) items.push({ track: { points: [{ lat: 30.5 + i * 0.036, lng: 114.4 }] } });

  const full = unionOf(items);
  const core = coreBbox(items, { minKm: 0.001 });
  const coreKm = (core.maxLat - core.minLat) * 111;
  const fullKm = (full.maxLat - full.minLat) * 111;
  assert.ok(coreKm >= fullKm * 0.8, `均匀分散时核心应覆盖整组跨度的绝大部分，实际 ${coreKm.toFixed(1)}/${fullKm.toFixed(1)}km`);
});

test('CB6 核心区：跨度代价相同时优先要活动量大的那团，不为一条零散录制撑宽主图', () => {
  // 9.6km 外一条 5 点的零散录制放在数组首位：只按跨度便宜来挑的话它会被抢先选中
  const stray = { track: { points: Array.from({ length: 5 }, (_, k) => ({ lat: 30.5001 + k * 0.00002, lng: 114.5 })) } };
  const items = [stray];
  for (let i = 0; i < 3; i++) {
    const points = [];
    for (let k = 0; k < 30; k++) points.push({ lat: 30.5 + (k % 6) * 0.00002, lng: 114.4 + Math.floor(k / 6) * 0.00002 + i * 0.00002 });
    items.push({ track: { points } });
  }

  const core = coreBbox(items);
  assert.ok(core.maxLng < 114.45, `核心不该被 9.6km 外 5 点的零散录制拉到东边，实际 maxLng=${core.maxLng}`);
});

test('CB4 核心区：无有效点返回 null', () => {
  assert.equal(coreBbox([]), null);
  assert.equal(coreBbox([{ track: { points: [] } }, { track: { points: [{ lat: NaN, lng: 1 }] } }]), null);
});

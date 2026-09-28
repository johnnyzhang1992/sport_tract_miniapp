/**
 * track-map 组件「采样断档连线断开」回归（components/track-map/track-map.js）
 *
 * 断档连线（gapJump）= 服务端判出的「丢锁几秒后重定位超前」那条不可信弦（斜穿内场）。
 * 这里断的是真渲染口径：三种着色模式（默认轮换色 / 配速 / 海拔）都不许把
 * 「断档前一点 → 落点」这条线画出来，同时一个点都不能丢（点保留、指标不变，只是线不画）。
 * 跑法：node --test test/track-map-gap-jump.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

let comp = null;
global.Component = (o) => {
  comp = o;
};
global.wx = {
  getStorageSync: () => '',
  setStorageSync() {},
  createMapContext: () => ({ includePoints() {}, moveToLocation() {} }),
};
require('../miniprogram/components/track-map/track-map.js');

const M_PER_DEG = 180 / (Math.PI * 6371000);
const T0 = 1700000000000;
const ROUND = 9; // 坐标按 9 位小数比对（约 0.1mm），避开浮点尾差

/** 每步 { sec, speed, gapJump?, pauseGap?, altitude? }，沿经线推进 */
function track(steps) {
  let m = 0;
  let t = T0;
  const pts = [{ lat: 30, lng: 114.4, timestamp: t, altitude: 100 }];
  for (const s of steps) {
    m += s.speed * s.sec;
    t += s.sec * 1000;
    pts.push({
      lat: 30 + m * M_PER_DEG,
      lng: 114.4,
      timestamp: t,
      altitude: s.altitude != null ? s.altitude : 100 + Math.round(m / 10),
      ...(s.gapJump ? { gapJump: true } : {}),
      ...(s.pauseGap ? { pauseGap: true } : {}),
    });
  }
  return pts;
}

/** 用假 this 调 buildPolyline，返回 setData 收到的 polyline */
function build(points, colorMode, activityType) {
  let out = null;
  const ctx = {
    data: { mode: 'single', points, markers: [], colorMode, activityType, overviewTracks: [] },
    setData(obj) {
      out = obj.polyline ?? out;
    },
    buildAltitudePolyline: comp.methods.buildAltitudePolyline,
    buildPacePolyline: comp.methods.buildPacePolyline,
    buildDefaultPolyline: comp.methods.buildDefaultPolyline,
    splitByMarkers: comp.methods.splitByMarkers,
  };
  comp.methods.buildPolyline.call(ctx);
  assert.ok(out, 'buildPolyline 应 setData 一份 polyline');
  return out;
}

const key = (p) => `${p.latitude.toFixed(ROUND)},${p.longitude.toFixed(ROUND)}`;
const walk = (pts) => ({ latitude: pts.lat, longitude: pts.lng });

/** 该弦是否被画进了某条 polyline（相邻两点恰好是 a→b） */
function chordDrawn(lines, a, b) {
  const from = key(walk(a));
  const to = key(walk(b));
  return lines.some((l) =>
    l.points.some((p, i) => i > 0 && key(l.points[i - 1]) === from && key(p) === to),
  );
}
const covered = (lines) => new Set(lines.flatMap((l) => l.points.map(key)));

const cruise = { sec: 20, speed: 2.5 }; // 50m/20s
const chordStep = { sec: 7, speed: 12, gapJump: true }; // 84m/7s ≈ 12m/s 的断档蹦跳

/** 断档前后各 3 步正常，中间一步蹦出去 84m */
function chordTrack(extraTag) {
  const steps = [cruise, cruise, { ...chordStep, ...(extraTag || {}) }, cruise, cruise];
  return track(steps);
}

for (const mode of ['default', 'pace', 'altitude']) {
  test(`${mode} 着色：断档连线不画，但点一个不少`, () => {
    const pts = chordTrack();
    const before = pts[2];
    const after = pts[3];
    assert.equal(after.gapJump, true, '夹具：第 3 点是断档落点');

    const lines = build(pts, mode, mode === 'altitude' ? 'hiking' : 'running');
    assert.ok(!chordDrawn(lines, before, after), `${mode} 模式不应画出斜穿的那条弦`);

    // 一个点都不能少：断线只去掉这条连线，轨迹本身仍完整可见
    const got = covered(lines);
    pts.forEach((p) => assert.ok(got.has(key(walk(p))), `点位缺失：${p.lat}`));
  });
}

test('同一个点同时带 pauseGap 与 gapJump：仍只断开一次，不产生空段', () => {
  const pts = chordTrack({ pauseGap: true });
  const lines = build(pts, 'pace', 'running');
  assert.ok(!chordDrawn(lines, pts[2], pts[3]), '两标叠加也该断开');
  const left = new Set(pts.slice(0, 3).map((p) => key(walk(p))));
  const right = new Set(pts.slice(3).map((p) => key(walk(p))));
  assert.ok(
    lines.every((l) => {
      const ks = new Set(l.points.map(key));
      const hitsLeft = [...ks].some((k) => left.has(k));
      const hitsRight = [...ks].every((k) => right.has(k));
      return !(hitsLeft && hitsRight);
    }),
    '任何一条 polyline 都不该跨过断开处',
  );
});

test('无标记的对照轨迹：两种口径都连成一条完整线', () => {
  const pts = track([cruise, cruise, cruise, cruise]);
  const lines = build(pts, 'pace', 'running');
  for (let i = 1; i < pts.length; i++) {
    assert.ok(chordDrawn(lines, pts[i - 1], pts[i]), `第 ${i} 步应连着画`);
  }
});

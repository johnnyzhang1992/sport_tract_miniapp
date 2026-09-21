/**
 * 配速计算共用工具单元测试（node:test，无 wx 依赖）
 * 运行：node --test test/
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const pace = require('../miniprogram/utils/track-pace');

const M_PER_DEG_LAT = (2 * Math.PI * 6371000) / 360; // 与 haversine 同源，保证位移精确
const T0 = 1700000000000;

/**
 * 造轨迹：每步 { sec, speed(m/s), pauseGap }，沿经线等距推进
 * pauseGap 标记在「恢复后的第一个点」上（与 track-map 约定一致）
 */
function makeTrack(steps) {
  let lat = 30;
  let t = T0;
  const pts = [{ lat, lng: 120, timestamp: t, pauseGap: false }];
  for (const s of steps) {
    lat += (s.speed * s.sec) / M_PER_DEG_LAT;
    t += s.sec * 1000;
    pts.push({ lat, lng: 120, timestamp: t, pauseGap: !!s.pauseGap });
  }
  return pts;
}

const repeat = (n, step) => Array.from({ length: n }, () => ({ ...step }));

test('haversineKm：沿经线 1 度 ≈ 111.19km，兼容 {latitude,longitude}', () => {
  const d = pace.haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
  assert.ok(Math.abs(d - 111.195) < 0.01, `1 度纬度 -> ${d}`);
  assert.equal(pace.haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 0 }), 0);
  const d2 = pace.haversineKm({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 });
  assert.equal(d2, d);
});

test('splitByPauseGaps：按 pauseGap 断开，且丢弃不足 2 点的段', () => {
  const pts = makeTrack([...repeat(3, { sec: 1, speed: 3 }), { sec: 20, speed: 3, pauseGap: true }, ...repeat(3, { sec: 1, speed: 3 })]);
  const segs = pace.splitByPauseGaps([pts]);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].length, 4); // 前 3 段 + 断点前的最后一点
  assert.equal(segs[1].length, 4); // 断点（pauseGap 点）起算
  assert.equal(segs[1][0].pauseGap, true);
  // 孤点段（首点即 pauseGap）不参与绘制
  assert.equal(pace.splitByPauseGaps([[{ lat: 30, lng: 120, timestamp: T0, pauseGap: true }]]).length, 0);
});

test('computeSegPaces：匀速 3m/s → 各点平滑配速恒为 333.3 秒/公里，起步位移不足为 null', () => {
  const segs = pace.splitByPauseGaps([makeTrack(repeat(60, { sec: 1, speed: 3 }))]);
  const paces = pace.computeSegPaces(segs)[0];
  assert.equal(paces.length, 61);
  assert.equal(paces[0], null); // 段首无前一点
  assert.equal(paces[1], null); // 位移 3m < 5m，视为原地
  assert.ok(Math.abs(paces[2] - 1000 / 3) < 0.01);
  assert.ok(Math.abs(paces[60] - 1000 / 3) < 0.01);
  // 窗口不跨 pauseGap：断点后一段的段首仍为 null
  const segs2 = pace.splitByPauseGaps([
    makeTrack([...repeat(30, { sec: 1, speed: 3 }), { sec: 30, speed: 3, pauseGap: true }, ...repeat(30, { sec: 1, speed: 3 })]),
  ]);
  const paces2 = pace.computeSegPaces(segs2);
  assert.equal(paces2.length, 2);
  assert.equal(paces2[1][0], null);
  assert.ok(paces2[1][5] != null);
});

test('paceSamples：pauseGap 断档步与 >60s 断档步都不计入时长', () => {
  const pts = makeTrack([...repeat(30, { sec: 1, speed: 3 }), { sec: 120, speed: 3 }, ...repeat(30, { sec: 1, speed: 3 })]);
  const samples = pace.paceSamples(pts);
  const total = samples.reduce((s, x) => s + x.sec, 0);
  assert.equal(total, 58); // 前后各 30 步各丢 1 步起步点（窗口位移 <5m），120s 断档步剔除
  assert.ok(samples.every((x) => x.sec === 1));
  // 无时间戳 / 原地不动 → 无采样
  assert.equal(pace.paceSamples([{ lat: 30, lng: 120 }, { lat: 30.001, lng: 120 }]).length, 0);
  assert.equal(pace.paceSamples([{ lat: 30, lng: 120, timestamp: T0 }, { lat: 30, lng: 120, timestamp: T0 + 1000 }]).length, 0);
});

test('computeRunPaceZones：匀速跑 → 全部落在 1.00× 对应区间（乳酸阈值），百分比合计 100', () => {
  const pts = makeTrack(repeat(90, { sec: 1, speed: 3 }));
  const r = pace.computeRunPaceZones(pts, 1000 / 3);
  assert.equal(r.hasData, true);
  assert.equal(r.totalSec, 89);
  assert.ok(Math.abs(r.anchorPace - 1000 / 3) < 0.01);
  const hit = r.zones.filter((z) => z.sec > 0);
  assert.equal(hit.length, 1);
  assert.equal(hit[0].key, 'threshold');
  assert.equal(hit[0].percent, 100);
  assert.equal(hit[0].ratioText, '0.97–1.05×');
  assert.equal(r.zones.reduce((s, z) => s + z.percent, 0), 100);
  // 区间边界 = 平均配速 × 比例
  assert.equal(r.zones[1].paceText, `5'00"–5'23"`); // 0.90×–0.97× × 5'33"
  assert.equal(r.zones[5].paceText, `≥7'13"`); // 1.30× × 5'33"
});

test('computeRunPaceZones：慢/快两段 → 分别落档，时长与百分比对称，合计 100', () => {
  const pts = makeTrack([
    ...repeat(90, { sec: 1, speed: 3 }),
    { sec: 1, speed: 2.4, pauseGap: true },
    ...repeat(90, { sec: 1, speed: 2.4 }),
  ]);
  const r = pace.computeRunPaceZones(pts, 1000 / 3);
  const byKey = Object.fromEntries(r.zones.map((z) => [z.key, z]));
  assert.equal(byKey.threshold.sec, 89); // 3 m/s → 1.00×
  assert.equal(byKey.easy.sec, 88); // 2.4 m/s → 1.25×（轻松跑 1.15–1.30×）
  assert.equal(byKey.threshold.percent, 50);
  assert.equal(byKey.easy.percent, 50);
  assert.equal(byKey.threshold.durationText, '01:29');
  assert.equal(byKey.easy.durationText, '01:28');
  assert.equal(r.zones.reduce((s, z) => s + z.percent, 0), 100);
});

test('computeRunPaceZones：三档均分 → 取整后合计仍为 100（最大余数法）', () => {
  const pts = makeTrack([
    ...repeat(100, { sec: 1, speed: 3 }),
    { sec: 1, speed: 2.6, pauseGap: true },
    ...repeat(100, { sec: 1, speed: 2.6 }),
    { sec: 1, speed: 2.3, pauseGap: true },
    ...repeat(100, { sec: 1, speed: 2.3 }),
  ]);
  const r = pace.computeRunPaceZones(pts, 1000 / 3);
  const hit = r.zones.filter((z) => z.sec > 0);
  assert.deepEqual(hit.map((z) => z.key), ['threshold', 'easy', 'warmup']);
  assert.equal(r.zones.reduce((s, z) => s + z.percent, 0), 100);
  hit.forEach((z) => assert.ok(z.percent >= 32 && z.percent <= 34, `${z.key} ${z.percent}%`));
});

test('computeRunPaceZones：锚点缺失时回退为采样时长加权均值；有效时长达不到下限则 hasData=false', () => {
  const pts = makeTrack([...repeat(100, { sec: 1, speed: 3 }), { sec: 1, speed: 2.4, pauseGap: true }, ...repeat(60, { sec: 1, speed: 2.4 })]);
  const r = pace.computeRunPaceZones(pts, 0);
  assert.equal(r.hasData, true);
  // 加权均值介于两段配速之间，且以 3m/s 段为主
  assert.ok(r.anchorPace > 333 && r.anchorPace < 417, `anchor ${r.anchorPace}`);
  assert.equal(pace.computeRunPaceZones([], 300).hasData, false);
  assert.equal(pace.computeRunPaceZones(makeTrack([{ sec: 10, speed: 0 }]), 300).hasData, false);
  // 49 秒的短轨迹：分布无参考意义，不展示
  assert.equal(pace.computeRunPaceZones(makeTrack(repeat(49, { sec: 1, speed: 3 })), 1000 / 3).hasData, false);
  assert.equal(pace.computeRunPaceZones(makeTrack(repeat(61, { sec: 1, speed: 3 })), 1000 / 3).hasData, true);
});

test('formatPaceShort：秒进位到分', () => {
  assert.equal(pace.formatPaceShort(300), `5'00"`);
  assert.equal(pace.formatPaceShort(59.6), `1'00"`);
  assert.equal(pace.formatPaceShort(333.33), `5'33"`);
});

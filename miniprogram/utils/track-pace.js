/**
 * 配速计算共用工具（轨迹线着色 + 配速区间统计）
 * - 平滑配速：逐段配速受 GPS 抖动影响噪声极大，改为「以每个点为终点，回溯累计近 WINDOW_SEC 秒内的位移/用时」
 * - 配速区间：自锚定分档 —— 边界 = 本次平均配速 × 比例，不随跑者水平漂移，同一次运动内各区间可比
 * 单位统一为 秒/公里；距离为公里
 */
const { formatDuration } = require('./format');

const WINDOW_SEC = 45; // 平滑窗口时长
const MIN_WINDOW_M = 5; // 窗口累计位移下限（米）：低于视为原地，无有效配速
const MAX_BACK_GAP_SEC = 60; // 回溯断档阈值：相邻点间隔超过则不跨档回溯
const MAX_SAMPLE_GAP_SEC = 60; // 采样断档阈值：超过则该步不计入区间统计
const MIN_ZONE_TOTAL_SEC = 60; // 有效配速时长下限：过短（几十秒）的分布没有参考意义，不展示

/** 跑步配速区间（相对平均配速的比例，比例越小配速越快） */
const RUN_PACE_ZONES = [
  { key: 'interval', name: '高强度间歇', minRatio: 0, maxRatio: 0.9, color: '#ef4444' },
  { key: 'anaerobic', name: '无氧耐力', minRatio: 0.9, maxRatio: 0.97, color: '#f45b2d' },
  { key: 'threshold', name: '乳酸阈值', minRatio: 0.97, maxRatio: 1.05, color: '#f97316' },
  { key: 'marathon', name: '马拉松配速', minRatio: 1.05, maxRatio: 1.15, color: '#f99f12' },
  { key: 'easy', name: '轻松跑', minRatio: 1.15, maxRatio: 1.3, color: '#facc15' },
  { key: 'warmup', name: '缓和热身', minRatio: 1.3, maxRatio: Infinity, color: '#8ec839' },
];

const lat = (p) => (p.lat != null ? p.lat : p.latitude);
const lng = (p) => (p.lng != null ? p.lng : p.longitude);

/** 两点球面距离（公里），兼容 {lat,lng} 与 {latitude,longitude} */
function haversineKm(a, b) {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const aLat = lat(a);
  const bLat = lat(b);
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(lng(b) - lng(a));
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** 按 pauseGap 标记切分段（暂停间隙断开）：前一段不含 pauseGap 点，后一段从该点开始 */
function splitByPauseGaps(segs) {
  const result = [];
  for (const seg of segs) {
    let start = 0;
    for (let i = 0; i < seg.length; i++) {
      if (seg[i].pauseGap && i > start) {
        result.push(seg.slice(start, i));
        start = i;
      }
    }
    if (start < seg.length) result.push(seg.slice(start));
  }
  return result.filter((s) => s.length >= 2);
}

/**
 * 逐点平滑配速（秒/公里）：与段内点等长，段首与异常点为 null
 * 原地（窗口位移 < MIN_WINDOW_M）或时间戳缺失 → null
 */
function computeSegPaces(segs, windowSec = WINDOW_SEC) {
  return segs.map((seg) => {
    const paces = new Array(seg.length).fill(null);
    for (let i = 1; i < seg.length; i++) {
      const a = seg[i - 1];
      const b = seg[i];
      if (!a.timestamp || !b.timestamp) continue;
      let dt = (b.timestamp - a.timestamp) / 1000;
      if (!Number.isFinite(dt) || dt <= 0) continue;
      let d = haversineKm(a, b) * 1000;
      let j = i - 1;
      while (j > 0 && dt < windowSec) {
        if (seg[j].vehicle) break; // 不跨车速段回看：否则下车后第一步会把车上的位移算进自己的配速
        const sdt = (seg[j].timestamp - seg[j - 1].timestamp) / 1000;
        if (!Number.isFinite(sdt) || sdt < 0 || sdt > MAX_BACK_GAP_SEC) break; // 不跨断档回溯
        dt += sdt;
        d += haversineKm(seg[j - 1], seg[j]) * 1000;
        j--;
      }
      paces[i] = d >= MIN_WINDOW_M ? dt / (d / 1000) : null;
    }
    return paces;
  });
}

/**
 * 配速采样：[{ pace, sec }]，pauseGap 断开、断档步与原地步剔除
 * vehicle 步（服务端判出的非运动段，图上灰显）一律不采：搭车的 25km/h 落进强度分布等于凭空造 PR
 */
function paceSamples(points) {
  const segs = splitByPauseGaps([points || []]);
  const segPaces = computeSegPaces(segs);
  const out = [];
  segs.forEach((seg, si) => {
    const paces = segPaces[si];
    for (let i = 1; i < seg.length; i++) {
      const pace = paces[i];
      if (pace == null || seg[i].vehicle) continue;
      const sec = (seg[i].timestamp - seg[i - 1].timestamp) / 1000;
      if (!Number.isFinite(sec) || sec <= 0 || sec > MAX_SAMPLE_GAP_SEC) continue;
      out.push({ pace, sec });
    }
  });
  return out;
}

/** 秒/公里 → 4'59"（区间边界用短格式，不带单位；秒进位到分） */
function formatPaceShort(secPerKm) {
  const total = Math.round(secPerKm);
  const m = Math.floor(total / 60);
  return `${m}'${String(total % 60).padStart(2, '0')}"`;
}

function ratioTextOf(zone) {
  const f = (v) => v.toFixed(2);
  if (zone.minRatio === 0) return `≤${f(zone.maxRatio)}×`;
  if (zone.maxRatio === Infinity) return `≥${f(zone.minRatio)}×`;
  return `${f(zone.minRatio)}–${f(zone.maxRatio)}×`;
}

/** 区间配速范围（秒/公里）：比例大 → 配速慢 → 数值大 */
function paceTextOf(zone, anchor) {
  const fast = zone.maxRatio === Infinity ? null : zone.maxRatio * anchor;
  const slow = zone.minRatio === 0 ? null : zone.minRatio * anchor;
  if (slow == null) return `≤${formatPaceShort(fast)}`;
  if (fast == null) return `≥${formatPaceShort(slow)}`;
  return `${formatPaceShort(slow)}–${formatPaceShort(fast)}`;
}

/**
 * 跑步配速区间分布
 * @param points 轨迹点（含 lat/lng/timestamp/pauseGap）
 * @param avgPaceSecPerKm 锚点（本次平均配速）；无效时回退为采样时长加权均值
 * @returns { hasData, anchorPace, totalSec, zones:[{key,name,color,ratioText,paceText,sec,durationText,percent,pctText,barPct}] }
 */
function computeRunPaceZones(points, avgPaceSecPerKm) {
  const samples = paceSamples(points);
  const totalSec = samples.reduce((s, x) => s + x.sec, 0);
  let anchor = avgPaceSecPerKm;
  if (!Number.isFinite(anchor) || anchor <= 0) {
    anchor = totalSec > 0 ? samples.reduce((s, x) => s + x.pace * x.sec, 0) / totalSec : 0;
  }
  if (totalSec < MIN_ZONE_TOTAL_SEC || !(anchor > 0)) {
    return { hasData: false, anchorPace: 0, totalSec: Math.round(totalSec), zones: [] };
  }

  const secByZone = RUN_PACE_ZONES.map(() => 0);
  for (const s of samples) {
    const ratio = s.pace / anchor;
    let idx = RUN_PACE_ZONES.findIndex((z) => ratio < z.maxRatio);
    if (idx < 0) idx = RUN_PACE_ZONES.length - 1;
    secByZone[idx] += s.sec;
  }

  // 百分比取整后按最大余数法补齐到 100，避免四舍五入后合计 99/101
  const raw = secByZone.map((sec) => (sec / totalSec) * 100);
  const percent = raw.map((x) => Math.floor(x));
  const rest = 100 - percent.reduce((a, b) => a + b, 0);
  raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac)
    .slice(0, Math.max(0, rest))
    .forEach(({ i }) => {
      percent[i] += 1;
    });

  const zones = RUN_PACE_ZONES.map((zone, i) => {
    const sec = Math.round(secByZone[i]);
    return {
      key: zone.key,
      name: zone.name,
      color: zone.color,
      ratioText: ratioTextOf(zone),
      paceText: paceTextOf(zone, anchor),
      sec,
      durationText: formatDuration(sec),
      percent: percent[i],
      pctText: sec > 0 && percent[i] === 0 ? '<1' : String(percent[i]),
      barPct: percent[i] > 0 ? Math.max(percent[i], 3) : 0, // 极窄条也给 3% 可辨宽度
    };
  });

  return {
    hasData: true,
    anchorPace: anchor,
    totalSec: Math.round(totalSec),
    zones,
  };
}

module.exports = {
  WINDOW_SEC,
  MIN_ZONE_TOTAL_SEC,
  RUN_PACE_ZONES,
  haversineKm,
  splitByPauseGaps,
  computeSegPaces,
  paceSamples,
  computeRunPaceZones,
  formatPaceShort,
};

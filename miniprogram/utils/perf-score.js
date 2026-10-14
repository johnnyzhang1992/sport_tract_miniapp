/**
 * 表现分（Performance Index）：ITRA 风格幂律评分的社区逆向模型，
 * 常量移植自 TrailCraft（commit 5 refit），与服务端 utils/perf-score.ts 同一套公式。
 *
 *   PI = min(1000, round(77.9 × (kme/小时)^0.85 × (kme/270)^0.155))
 *   kme = 距离km + 爬升m/100（v1 不含下降项，等价 TrailCraft 的 spiRawScore）
 *
 * 等级线：680 精英级 / 500 优秀 / 380 良好 / 200 中等 / 其余 入门。
 * 仅对类跑步类型有意义；展示时须标注"社区估算，非官方 ITRA 分"。
 */

const PERF_C = 77.9;
const PERF_K = 0.85;
const PERF_M = 0.155;
const PERF_KME_REF = 270;

const PERF_LEVELS = [
  { threshold: 680, label: '精英级' },
  { threshold: 500, label: '优秀' },
  { threshold: 380, label: '良好' },
  { threshold: 200, label: '中等' },
  { threshold: 0, label: '入门' },
];

/** 表现分适用的运动类型（与服务端 PERF_RUN_LIKE 同步） */
const PERF_RUN_LIKE = ['running', 'walking', 'hiking', 'mountaineering'];

/**
 * @param {string} type 运动类型
 * @param {number} distanceM 距离（米）
 * @param {number} ascentM 爬升（米）
 * @param {number} durationSec 时长（秒）
 * @returns {{score:number, level:string}|null} 不适用/数据不足为 null
 */
function calcPerfScore(type, distanceM, ascentM, durationSec) {
  if (PERF_RUN_LIKE.indexOf(type) < 0) return null;
  if (!(distanceM >= 1000) || !(durationSec >= 300)) return null;
  const kme = distanceM / 1000 + ascentM / 100;
  const hours = durationSec / 3600;
  if (!(kme > 0) || !(hours > 0)) return null;
  const speed = kme / hours;
  const lengthFactor = Math.pow(kme / PERF_KME_REF, PERF_M);
  const score = Math.round(Math.min(PERF_C * Math.pow(speed, PERF_K) * lengthFactor, 1000));
  const level = (PERF_LEVELS.find((l) => score >= l.threshold) || PERF_LEVELS[PERF_LEVELS.length - 1]).label;
  return { score, level };
}

/** 分数 → 等级文案 */
function perfLevel(score) {
  return (PERF_LEVELS.find((l) => score >= l.threshold) || PERF_LEVELS[PERF_LEVELS.length - 1]).label;
}

module.exports = { calcPerfScore, perfLevel };

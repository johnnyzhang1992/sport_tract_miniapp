/**
 * 配速绝对刻度（按运动类型分别定，单位：秒/公里）
 * - fast：最快档（色带最深 · 深黄）；slow：最慢档（色带最浅 · 浅绿）
 * - 轨迹线配速着色用绝对刻度映射，同类型跨轨迹颜色可比
 * - 超出刻度截断：比 fast 更快 → 最深；比 slow 更慢 → 最浅
 */
const PACE_SCALE = {
  running: { fast: 180, slow: 600 }, // 跑步 3'00" ~ 10'00"
  walking: { fast: 360, slow: 1500 }, // 散步 6'00" ~ 25'00"
  hiking: { fast: 420, slow: 1800 }, // 徒步 7'00" ~ 30'00"
  mountaineering: { fast: 480, slow: 2400 }, // 爬山 8'00" ~ 40'00"
  cycling: { fast: 90, slow: 480 }, // 骑行 40km/h ~ 7.5km/h
  swimming: { fast: 1200, slow: 3600 }, // 游泳 20'00" ~ 60'00"
  skiing: { fast: 60, slow: 600 }, // 滑雪 60km/h ~ 6km/h
  rowing: { fast: 300, slow: 1200 }, // 划船 12km/h ~ 3km/h
};

/** 未识别类型的兜底刻度 3'00" ~ 30'00" */
const DEFAULT_SCALE = { fast: 180, slow: 1800 };

function getPaceScale(type) {
  return PACE_SCALE[type] || DEFAULT_SCALE;
}

module.exports = { PACE_SCALE, getPaceScale };

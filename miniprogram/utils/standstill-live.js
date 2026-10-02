/**
 * 录入端实时「静止挂机」判定与自动暂停
 *
 * 场景：用户点了开始运动但忘停（回家/睡觉/手机放桌上），轨迹会挂上几十小时——
 * 距离没涨但时长一路灌水。服务端纠偏会把静止段剔掉，但录制当下就应该提醒/止损。
 *
 * 触发（每段静止只触发一次）：连续静止 >5 分钟 → tracker 自动暂停 + 页面 toast
 * （用户回来动一下即可恢复，恢复逻辑与手动暂停一致）。
 *
 * 只看静止时长，不要求占运动总时长的比例——挂机场景里运动越久反而越难越线，与"止损"目的相反。
 *
 * 静止判定口径：相邻定位点位移 < 阈值（服务端 STANDSTILL_RADIUS_M=10m 同口径，端上取 8m 略严）。
 * 状态机：一旦走动（超阈值位移）即重置；触发后不再重复触发（恢复走动后重新武装）。
 */
const { haversineKm } = require('./track-pace');

const STANDSTILL_LIVE_THRESHOLDS = {
  /** 静止判定：相邻点位移小于该值（米）视为没动 */
  STILL_RADIUS_M: 8,
  /** 连续静止超过该秒数即自动暂停 */
  AUTO_PAUSE_MIN_SEC: 300,
  /** 断档（定位丢失/切后台）超过该秒数：重置（无法判断中间是否走动） */
  MAX_STEP_SEC: 180,
};

/**
 * 造一个逐步喂入的观察器（tracker 每接受一个定位点调用一次）
 * @param {object} opts
 * @param {function} opts.onAutoPause 自动暂停回调（tracker 执行 pause）
 * @returns {{ step(prev, cur): void, reset(): void }}
 */
function createStandstillWatcher(opts) {
  const t = STANDSTILL_LIVE_THRESHOLDS;
  const onAutoPause = opts.onAutoPause || (() => {});

  let stillSec = 0;
  let autoPaused = false; // 触发后挂起，走动后重新武装

  const reset = () => {
    stillSec = 0;
    autoPaused = false;
  };

  return {
    /** @returns {number} 这一步之后的连续静止秒数（走动或断档归零后返回 0）——录入端拿它做 autoPausedMs */
    step(prev, cur) {
      if (!prev || !cur) return 0;
      const dt = (cur.timestamp - prev.timestamp) / 1000;
      if (!Number.isFinite(dt) || dt <= 0 || dt > t.MAX_STEP_SEC) {
        reset(); // 断档：中间可能走动过，重新计数
        return 0;
      }
      const movedM = haversineKm(prev, cur) * 1000;
      if (movedM >= t.STILL_RADIUS_M) {
        // 走动了：全部重置（重新武装两级观察器）
        reset();
        return 0;
      }
      // 静止：累计
      stillSec += dt;

      // 连续静止 >5 分钟：自动暂停，一次（恢复走动后重新武装）
      if (!autoPaused && stillSec > t.AUTO_PAUSE_MIN_SEC) {
        autoPaused = true;
        onAutoPause({ stillSec });
      }
      return stillSec;
    },
    reset,
  };
}

/** 走动判据：步数、每步位移、合位移、单步间隔上限（间隔与静止判据同口径） */
const MOVEMENT_THRESHOLDS = {
  MOVE_MIN_STEPS: 3,
  /** 单步位移下限（米）：与静止判据 STILL_RADIUS_M 同一条线，两边共用一个几何事实 */
  MOVE_STEP_M: 8,
  /** 3 步合位移下限（米）：只抖一步 12m 又回去的路径，靠这条挡掉 */
  MOVE_TOTAL_M: 30,
};

/**
 * 造一个"确实在走动"观察器（自动暂停期间喂定位用，判够就自动接回记录）
 * 逐步喂入 { lat, lng, timestamp }：任何一步不合格（位移不足、间隔超上限、时间倒流）
 * 就把连走计数清零、从这一步重新起算——所以"连续"是硬条件。
 * 判定成功后内部清零，可继续复用（下一次暂停不必重建）。
 * @param {function} onMove 判够 3 步时回调一次
 */
function createMovementWatcher(opts = {}) {
  const t = Object.assign({}, MOVEMENT_THRESHOLDS, opts.thresholds || {});
  const maxStepSec = STANDSTILL_LIVE_THRESHOLDS.MAX_STEP_SEC;
  const onMove = opts.onMove || (() => {});

  let prev = null;
  let steps = 0;
  let totalM = 0;

  const reset = () => {
    prev = null;
    steps = 0;
    totalM = 0;
  };

  return {
    reset,
    /** @returns {boolean} 这一步之后是否已满足"在走动" */
    step(cur) {
      if (!cur || !Number.isFinite(cur.lat) || !Number.isFinite(cur.lng)) {
        reset();
        return false;
      }
      const last = prev;
      prev = cur;
      if (!last) return false;

      const dtSec = (cur.timestamp - last.timestamp) / 1000;
      const movedM = haversineKm(last, cur) * 1000;
      if (!(dtSec > 0) || dtSec > maxStepSec || movedM < t.MOVE_STEP_M) {
        steps = 0; // 这一步不可信：连走清零，从 cur 重新起算
        totalM = 0;
        return false;
      }
      steps += 1;
      totalM += movedM;
      if (steps >= t.MOVE_MIN_STEPS && totalM >= t.MOVE_TOTAL_M) {
        reset();
        onMove({ steps: t.MOVE_MIN_STEPS, totalM });
        return true;
      }
      return false;
    },
  };
}

module.exports = { createStandstillWatcher, createMovementWatcher, STANDSTILL_LIVE_THRESHOLDS };

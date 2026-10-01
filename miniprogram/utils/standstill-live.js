/**
 * 录入端实时「静止挂机」判定与自动暂停
 *
 * 场景：用户点了开始运动但忘停（回家/睡觉/手机放桌上），轨迹会挂上几十小时——
 * 距离没涨但时长一路灌水。服务端纠偏会把静止段剔掉，但录制当下就应该提醒/止损。
 *
 * 两级触发（都是每级只触发一次）：
 * 1. 提醒级：连续静止 ≥10 分钟 → 震动 + toast「是否暂停」
 * 2. 自动暂停级：连续静止超过「运动时长的 1/3」且 >15 分钟 → tracker 自动暂停
 *    （用户回来动一下即可恢复，恢复逻辑与手动暂停一致）
 *
 * 静止判定口径：相邻定位点位移 < 阈值（服务端 STANDSTILL_RADIUS_M=10m 同口径，端上取 8m 略严）。
 * 状态机：一旦走动（超阈值位移）即重置两个观察器；自动暂停触发后不再重复触发（恢复走动后重新武装）。
 */
const { haversineKm } = require('./track-pace');

const STANDSTILL_LIVE_THRESHOLDS = {
  /** 静止判定：相邻点位移小于该值（米）视为没动 */
  STILL_RADIUS_M: 8,
  /** 提醒级：连续静止时长（秒） */
  NOTIFY_SEC: 600,
  /** 自动暂停级：最小连续静止时长（秒） */
  AUTO_PAUSE_MIN_SEC: 900,
  /** 自动暂停级：静止须超过总运动时长的该比例 */
  AUTO_PAUSE_RATIO: 1 / 3,
  /** 断档（定位丢失/切后台）超过该秒数：重置（无法判断中间是否走动） */
  MAX_STEP_SEC: 180,
};

/**
 * 造一个逐步喂入的观察器（tracker 每接受一个定位点调用一次）
 * @param {object} opts
 * @param {number} opts.elapsedSec 当前运动时长（秒，含暂停前）——自动暂停级的比例分母
 * @param {function} opts.onNotify 提醒级回调（震动+toast 由页面处理）
 * @param {function} opts.onAutoPause 自动暂停回调（tracker 执行 pause）
 * @returns {{ step(prev, cur): void, reset(): void }}
 */
function createStandstillWatcher(opts) {
  const t = STANDSTILL_LIVE_THRESHOLDS;
  const onNotify = opts.onNotify || (() => {});
  const onAutoPause = opts.onAutoPause || (() => {});

  let stillSec = 0;
  let notified = false; // 提醒级每段只发一次
  let autoPaused = false; // 自动暂停触发后挂起，走动后重新武装

  const reset = () => {
    stillSec = 0;
    notified = false;
    autoPaused = false;
  };

  return {
    step(prev, cur, elapsedSec) {
      if (!prev || !cur) return;
      const dt = (cur.timestamp - prev.timestamp) / 1000;
      if (!Number.isFinite(dt) || dt <= 0 || dt > t.MAX_STEP_SEC) {
        reset(); // 断档：中间可能走动过，重新计数
        return;
      }
      const movedM = haversineKm(prev, cur) * 1000;
      if (movedM >= t.STILL_RADIUS_M) {
        // 走动了：全部重置（重新武装两级观察器）
        reset();
        return;
      }
      // 静止：累计
      stillSec += dt;
      const totalElapsed = elapsedSec != null ? elapsedSec : stillSec;

      // 1) 提醒级：连续静止 ≥10 分钟，一次
      if (!notified && stillSec >= t.NOTIFY_SEC) {
        notified = true;
        onNotify({ stillSec });
      }

      // 2) 自动暂停级：连续静止 > 运动时长 1/3 且 >15 分钟，一次（恢复走动后重新武装）
      if (!autoPaused && stillSec > t.AUTO_PAUSE_MIN_SEC && stillSec > totalElapsed * t.AUTO_PAUSE_RATIO) {
        autoPaused = true;
        onAutoPause({ stillSec });
      }
    },
    reset,
  };
}

module.exports = { createStandstillWatcher, STANDSTILL_LIVE_THRESHOLDS };

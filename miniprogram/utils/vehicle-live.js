/**
 * 录入端实时「疑似乘车」判定
 *
 * 为什么要在端上再判一遍：服务端 finish 时才会剔掉非运动段（见 sport_track_api/src/utils/vehicle.ts），
 * 用户要等到结束才知道「这一段没算进你的成绩」。录制当下给一次提示，人才有机会立刻停下/作废重录，
 * 而不是事后发现 5.95km 里 1.2km 是坐车蹭出来的。
 *
 * **阈值与服务端同口径，端上 import 不到后端代码，改一处必须改两处**：
 * ≥6.5 m/s（23.4km/h，城市车流速度）、连续 ≥60s、≥5 次定位、段内允许穿插 ≤2 个慢步（红绿灯）、
 * 相邻步 >120s 或手动暂停处重新计时。只对人力运动类型判（骑行/滑雪/划船 6.5 m/s 是正常速度）。
 *
 * 这里只做提示，不改数据：剔除仍以服务端为准，端上不参与算指标。
 */
const { haversineKm } = require('./track-pace');

const VEHICLE_LIVE_THRESHOLDS = {
  MIN_SPEED_MPS: 6.5,
  MIN_SEC: 60,
  MAX_SLOW_STEPS: 2,
  MIN_STEPS: 5,
  MAX_STEP_SEC: 120,
  TYPES: ['running', 'walking', 'hiking', 'mountaineering'],
};

/**
 * 造一个逐步喂入的观察器（tracker 每接受一个定位点调用一次）
 * @param {string} type 运动类型；非人力类型直接哑火
 * @returns {{ step(prev, cur): {avgMps:number, runSec:number}|false, reset(): void }}
 */
function createVehicleWatcher(type) {
  const armed = VEHICLE_LIVE_THRESHOLDS.TYPES.includes(type);
  const t = VEHICLE_LIVE_THRESHOLDS;
  let runSec = 0;
  let runDist = 0;
  let fastSteps = 0;
  let pendingSlow = 0;
  let notified = false;

  const reset = () => {
    runSec = 0;
    runDist = 0;
    fastSteps = 0;
    pendingSlow = 0;
    notified = false;
  };

  return {
    step(prev, cur) {
      if (!armed || !prev || !cur) return false;
      const dt = (cur.timestamp - prev.timestamp) / 1000;
      if (!Number.isFinite(dt) || dt <= 0 || dt > t.MAX_STEP_SEC || cur.pauseGap) {
        reset();
        return false;
      }
      const mps = (haversineKm(prev, cur) * 1000) / dt;
      if (mps >= t.MIN_SPEED_MPS) {
        runSec += dt;
        runDist += haversineKm(prev, cur) * 1000;
        fastSteps++;
        pendingSlow = 0;
        if (!notified && runSec >= t.MIN_SEC && fastSteps >= t.MIN_STEPS) {
          notified = true;
          return { avgMps: runDist / runSec, runSec };
        }
        return false;
      }
      // 慢步：只允许穿插 ≤2 步（等红灯），第 3 步说明人又在自己动，本段作废并重新武装
      if (runSec === 0 || pendingSlow >= t.MAX_SLOW_STEPS) {
        reset();
        return false;
      }
      runSec += dt;
      runDist += haversineKm(prev, cur) * 1000;
      pendingSlow++;
      return false;
    },
    reset,
  };
}

module.exports = { createVehicleWatcher, VEHICLE_LIVE_THRESHOLDS };

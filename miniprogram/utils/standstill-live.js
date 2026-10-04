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
 * 静止判定口径：停留点（stay point）检测——以窗口起点为锚，后续点仍在锚点半径内才算继续静止，
 * 与服务端 utils/standstill.ts 同一几何判据（半径端上取 8m，比服务端 10m 略严）。
 * **不能拿「相邻点位移」比半径**：端上 3m/3s 节流后，走路每步才 3.6~7.2m，逐点比 8m 会把匀速走
 * 当成静止（5 分钟后误触发自动暂停）——走路要「越走离锚点越远」才暴露，锚点口径才行。
 * 状态机：走出锚点圈 ↔ 断档 ↔ 暂停恢复点（pauseGap，服务端「不跨手动暂停」同款）都重锚；
 * 触发后挂起，重锚即重新武装。
 */
const { haversineKm } = require('./track-pace');

const STANDSTILL_LIVE_THRESHOLDS = {
  /** 静止判定：与当前静止窗口锚点的距离 ≤ 该值（米）才算没动 */
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
 * @returns {{ step(prev, cur): number, reset(): void }}
 */
function createStandstillWatcher(opts) {
  const t = STANDSTILL_LIVE_THRESHOLDS;
  const onAutoPause = opts.onAutoPause || (() => {});

  let anchor = null; // 当前静止窗口的锚点（窗口起点，与服务端 stay-point 同口径）
  let anchorTs = 0;
  let stillSec = 0;
  let autoPaused = false; // 触发后挂起，重锚（走动/断档/暂停）后重新武装

  const reset = () => {
    anchor = null;
    anchorTs = 0;
    stillSec = 0;
    autoPaused = false;
  };
  /** 以 p 为新锚点重开一个窗口 */
  const reanchor = (p) => {
    anchor = p;
    anchorTs = p.timestamp;
    stillSec = 0;
    autoPaused = false;
  };

  return {
    /** @returns {number} 这一步之后的连续静止秒数（重锚后返回 0）——录入端拿它做 autoPausedMs */
    step(prev, cur) {
      if (!prev || !cur) return 0;
      const dt = (cur.timestamp - prev.timestamp) / 1000;
      if (!Number.isFinite(dt) || dt <= 0 || dt > t.MAX_STEP_SEC) {
        reset(); // 断档：中间可能走动过，重新计数
        return 0;
      }
      // 暂停恢复点（tracker 打的 pauseGap）：静止窗口在这条链上断开，从恢复点重开
      // （服务端 markStandstill 也在 pauseGap 处 break，不跨暂停合并）
      if (cur.pauseGap) {
        reanchor(cur);
        return 0;
      }
      if (!anchor) {
        anchor = prev;
        anchorTs = prev.timestamp;
      }
      // 走出锚点圈：从这一点重开窗口（走路必然越走越远，锚点口径才不会把走路当静止）
      if (haversineKm(anchor, cur) * 1000 > t.STILL_RADIUS_M) {
        reanchor(cur);
        return 0;
      }
      stillSec = (cur.timestamp - anchorTs) / 1000;

      // 连续静止 >5 分钟：自动暂停，一次（重锚后重新武装）
      if (!autoPaused && stillSec > t.AUTO_PAUSE_MIN_SEC) {
        autoPaused = true;
        onAutoPause({ stillSec });
      }
      return stillSec;
    },
    reset,
  };
}

/** 走动判据：离暂停参照点的净位移 + 单步是否可信（喂进来的是原始定位，不经采点节流） */
const MOVEMENT_THRESHOLDS = {
  /** 至少要几个可信步 */
  MOVE_MIN_STEPS: 3,
  /** 离暂停参照点的净位移下限（米）：抖动是来回的、净位移不累积，只抖一步又原地回去的路径靠这条挡掉 */
  MOVE_TOTAL_M: 30,
  /** 单步速度上限（m/s）：真瞬移（几百米/秒）不可信；GPS 噪声能把单步抬到 7~10 m/s，故留到 12（与采点侧 maxAbsSpeed 同量级） */
  MOVE_MAX_STEP_MPS: 12,
};

/**
 * 造一个"确实在走动"观察器（自动暂停期间喂定位用，判够就自动接回记录）
 * 逐步喂入 { lat, lng, timestamp }：**以暂停参照点为锚**，走出 MOVE_TOTAL_M 米才算走动。
 * 不能拿单步位移比阈值——喂进来的是原始定位（~1Hz），走路每步才 1.2~3.6m，单步门槛永远凑不满。
 * 也不能拿"平均速度"当门槛：暂停可能很久，那段墙钟混进分母反而永远接不回。
 * 任何一步不合格（间隔超上限、时间倒流、瞬移）都从这一步重新立锚，所以"连续"是硬条件。
 * 判定成功后内部清零，可继续复用（下一次暂停不必重建）。
 * 已知代价：长时间原地停留时若定位中心缓慢漂出 30m（低精度设备），会被误判成走动——
 * 接回后静止判据 5 分钟内会再把它暂停回去，不会污染数据，故不加更多门槛。
 * @param {function} onMove 判够时回调一次
 */
function createMovementWatcher(opts = {}) {
  const t = Object.assign({}, MOVEMENT_THRESHOLDS, opts.thresholds || {});
  const maxStepSec = STANDSTILL_LIVE_THRESHOLDS.MAX_STEP_SEC;
  const onMove = opts.onMove || (() => {});

  let anchor = null; // 暂停参照点（离它走出 MOVE_TOTAL_M 才算走动）
  let prev = null;
  let steps = 0;

  const reseed = (p) => {
    anchor = p;
    prev = p;
    steps = 0;
  };
  const reset = () => {
    anchor = null;
    prev = null;
    steps = 0;
  };

  return {
    reset,
    /** @returns {boolean} 这一步之后是否已满足"在走动" */
    step(cur) {
      if (!cur || !Number.isFinite(cur.lat) || !Number.isFinite(cur.lng)) {
        reset();
        return false;
      }
      if (!anchor) {
        reseed(cur); // 首点只立锚
        return false;
      }
      const last = prev;
      const dtSec = (cur.timestamp - last.timestamp) / 1000;
      const stepM = haversineKm(last, cur) * 1000;
      // 断档 / 时间倒流 / 瞬移：这一步不可信，从当前点重新起算
      if (!(dtSec > 0) || dtSec > maxStepSec || stepM / dtSec > t.MOVE_MAX_STEP_MPS) {
        reseed(cur);
        return false;
      }
      prev = cur;
      steps += 1;

      const netM = haversineKm(anchor, cur) * 1000;
      if (steps >= t.MOVE_MIN_STEPS && netM >= t.MOVE_TOTAL_M) {
        reset(); // 判定成功，内部清零可复用
        onMove({ steps, totalM: netM });
        return true;
      }
      return false;
    },
  };
}

module.exports = { createStandstillWatcher, createMovementWatcher, STANDSTILL_LIVE_THRESHOLDS };

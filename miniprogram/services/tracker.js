/**
 * 运动记录器（决策：采点/节流/漂移过滤/指标计算/seq 分配，与 UI 解耦）
 * 纯逻辑模块：页面持有单例，onLocationChange 喂点，UI 读 snapshot()
 */
const config = require('../config/index');

const EARTH_RADIUS_M = 6371000;
/** 节流：最小采点距离（米） */
const MIN_DISTANCE_M = 3;
/** 节流：最小采点间隔（毫秒） */
const MIN_INTERVAL_MS = 3000;
/** 漂移过滤：最大瞬时速度（m/s，≈108km/h，超限视为漂移点） */
const MAX_SPEED_MPS = 30;
/** 爬升死区阈值（米，海拔误差范围内不累计） */
const CLIMB_DEAD_ZONE_M = 2;
/** 配速最小有效距离（米）：低于此值配速无意义（如刚起步/静止），显示 “—” */
const MIN_PACE_DISTANCE_M = 200;
/** 精度过滤阈值（米）：wx.onLocationChange 返回 accuracy（水平精度），超过则丢弃（室内/弱信号）。
 *  30 → 80：室内测试时 accuracy 常 50-100m，太严会全滤掉导致距离恒为 0 */
const MAX_ACCURACY_M = 80;

/** Haversine 球面距离（米），兼容 {lat,lng} 与 {latitude,longitude} 两种字段 */
function haversine(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const lat1 = a.latitude != null ? a.latitude : a.lat;
  const lng1 = a.longitude != null ? a.longitude : a.lng;
  const lat2 = b.latitude != null ? b.latitude : b.lat;
  const lng2 = b.longitude != null ? b.longitude : b.lng;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(s));
}

function getMet(type) {
  const meta = config.ACTIVITY_TYPES.find((t) => t.type === type);
  return meta ? meta.met : 3.5;
}

class Tracker {
  constructor(type, weightKg = 60, now = () => Date.now()) {
    this.type = type;
    this.weightKg = weightKg;
    /** 时钟源（可注入便于测试） */
    this.now = now;

    this.points = []; // 轨迹点 [{seq, lat, lng, altitude, speed, timestamp}]
    this.markers = []; // 打点
    this.seq = 0;
    this.lastPoint = null;
    this.lastSampleTime = 0;

    this.startTime = now();
    this.paused = false;
    this.pausedAt = 0;
    this.pausedMs = 0;

    this.distance = 0; // 米
    this.elevationGain = 0;
    this.maxAltitude = null;
  }

  /**
   * 采点入口（wx.onLocationChange 回调）
   * 节流（时间/距离双阈值）→ 漂移过滤 → 追加 + 指标累加
   * @returns {object|null} 新点或 null（被过滤）
   */
  addPoint(loc) {
    if (this.paused || !loc) return null;

    // 精度过滤：accuracy 超阈值（室内/弱信号）直接丢弃，避免轨迹乱跳
    if (typeof loc.accuracy === 'number' && loc.accuracy > MAX_ACCURACY_M) return null;

    // 防御：模拟器/部分机型 timestamp 可能是字符串，统一转数字
    const now = Number(loc.timestamp) || this.now();

    if (this.lastPoint) {
      const d = haversine(this.lastPoint, loc);
      const dt = (now - this.lastSampleTime) / 1000;
      // 时间/距离双阈值节流（F9：位置未变不重复采点）
      if (d < MIN_DISTANCE_M && dt < MIN_INTERVAL_MS / 1000) return null;
      // 漂移过滤：瞬时速度超阈值
      if (dt > 0 && d / dt > MAX_SPEED_MPS) return null;
    }

    const point = {
      seq: ++this.seq,
      lat: loc.latitude,
      lng: loc.longitude,
      altitude: typeof loc.altitude === 'number' ? Math.round(loc.altitude * 10) / 10 : null,
      speed:
        loc.speed != null && loc.speed >= 0 ? Math.round(loc.speed * 10) / 10 : null,
      timestamp: now,
    };

    // 海拔突变过滤（GPS 误差）：短时间变化率过大 → 该点海拔视为无效置 null
    if (point.altitude != null && this.lastPoint && this.lastPoint.altitude != null) {
      const dt = (now - this.lastSampleTime) / 1000;
      const dAlt = Math.abs(point.altitude - this.lastPoint.altitude);
      if (dt > 0 && dAlt > 5 && dAlt / dt > 0.8) {
        point.altitude = null;
      }
    }

    if (this.lastPoint) {
      this.distance += haversine(this.lastPoint, point);
      // 爬升：死区阈值滤波（决策 D16）
      if (point.altitude != null && this.lastPoint.altitude != null) {
        const diff = point.altitude - this.lastPoint.altitude;
        if (diff > CLIMB_DEAD_ZONE_M) this.elevationGain += diff;
      }
    }
    if (point.altitude != null) {
      this.maxAltitude =
        this.maxAltitude == null ? point.altitude : Math.max(this.maxAltitude, point.altitude);
    }

    this.points.push(point);
    this.lastPoint = point;
    this.lastSampleTime = now;
    return point;
  }

  pause() {
    if (!this.paused) {
      this.paused = true;
      this.pausedAt = this.now();
    }
  }

  resume() {
    if (this.paused) {
      this.pausedMs += this.now() - this.pausedAt;
      this.paused = false;
    }
  }

  /** 运动时长（秒，扣除暂停） */
  getDurationSec() {
    const end = this.paused ? this.pausedAt : this.now();
    return Math.max(0, (end - this.startTime - this.pausedMs) / 1000);
  }

  /** 完整指标（UI 展示 + finish 提交共用） */
  getStats() {
    const durationSec = this.getDurationSec();
    const met = getMet(this.type);
    return {
      distance: Math.round(this.distance),
      durationSec: Math.round(durationSec),
      // 配速：秒/公里（游泳/骑行不展示；距离过短配速无意义）
      pace:
        this.distance >= MIN_PACE_DISTANCE_M && !['swimming', 'cycling'].includes(this.type)
          ? Math.round(durationSec / (this.distance / 1000))
          : null,
      calories: Math.round(met * this.weightKg * (durationSec / 3600)),
      elevationGain: Math.round(this.elevationGain),
      maxAltitude: this.maxAltitude,
      pointCount: this.points.length,
      paused: this.paused,
    };
  }

  /** UI 轮询快照 */
  snapshot() {
    const s = this.getStats();
    return {
      ...s,
      distanceKm: (s.distance / 1000).toFixed(2),
      durationText: formatDuration(s.durationSec),
    };
  }

  /** 取 lastSeq 之后的新点（增量上传） */
  getNewPoints(fromSeq) {
    return this.points.filter((p) => p.seq > (fromSeq || 0));
  }

  /** 生成 final 包（结束运动时） */
  buildFinalPack(startAddress = '', endAddress = '') {
    return {
      trackPoints: this.points,
      markers: this.markers,
      startAddress,
      endAddress,
      pausedMs: this.pausedMs,
      endTime: this.paused ? this.pausedAt : this.now(),
      weightKg: this.weightKg,
    };
  }

  /** 新增打点（记录到本地，finish 时随 final 包提交） */
  addMarker(marker) {
    this.markers.push(marker);
    return marker;
  }
}

function formatDuration(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}

module.exports = { Tracker, haversine };

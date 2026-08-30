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
/** 爬升死区阈值（米，海拔误差范围内不累计） */
const CLIMB_DEAD_ZONE_M = 2;
/** 配速最小有效距离（米）：低于此值配速无意义（如刚起步/静止），显示 “—” */
const MIN_PACE_DISTANCE_M = 200;
/** 后台恢复预热：切后台超过该时长（毫秒）才启用；回前台 GPS 冷启动，前几秒定位漂移大 */
const BACKGROUND_GAP_MS = 30000;
/** 预热窗口（毫秒）：回前台后丢弃该窗口内的点，等 GPS 重新收敛 */
const RESUME_WARMUP_MS = 5000;
/** 按运动类型的实时过滤配置（决策：与后端 cleanTrajectory 类型配置一致，防骑行起步误杀等） */
const TYPE_TRACKER_CONFIG = {
  walking: { maxAccuracyM: 60, minSpikeSpeed: 5, maxAbsSpeed: 12, minHighSpeed: 7 },
  hiking: { maxAccuracyM: 60, minSpikeSpeed: 5, maxAbsSpeed: 12, minHighSpeed: 7 },
  running: { maxAccuracyM: 50, minSpikeSpeed: 8, maxAbsSpeed: 18, minHighSpeed: 10 },
  cycling: { maxAccuracyM: 40, minSpikeSpeed: 12, maxAbsSpeed: 30, minHighSpeed: 14 },
  mountaineering: { maxAccuracyM: 80, minSpikeSpeed: 5, maxAbsSpeed: 12, minHighSpeed: 7 },
  swimming: { maxAccuracyM: 60, minSpikeSpeed: 3, maxAbsSpeed: 8, minHighSpeed: 5 },
};
const DEFAULT_TRACKER_CONFIG = TYPE_TRACKER_CONFIG.running;
/** 反转漂移过滤：新点相对上一有效点的方向与上一段方向夹角超过该角度（°）且移动缓慢 → 视为 GPS 乱跳丢弃 */
const REVERSE_TURN_DEG = 120;
/** 反转漂移过滤：判定为“移动缓慢”的速度上限（m/s） */
const REVERSE_SLOW_SPEED_MPS = 2;

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
    this._recentSpeeds = []; // 局部速度窗口（尖刺判定用）
    // 按运动类型阈值（防骑行起步/跑步冲刺被误杀）
    this._typeCfg = TYPE_TRACKER_CONFIG[type] || DEFAULT_TRACKER_CONFIG;
    this.pausedAt = 0;
    this.pausedMs = 0;
    this._pendingGap = false; // 暂停恢复后待标记的 pauseGap（打到恢复后首个有效点）

    this.distance = 0; // 米
    this.elevationGain = 0;
    this.maxAltitude = null;

    // 前后台切换：切后台时间戳 + 回前台预热窗口（冷启动漂移过滤）
    this._backgroundAt = 0;
    this._resumeWarmupUntil = 0;
  }

  /**
   * 采点入口（wx.onLocationChange 回调）
   * 节流（时间/距离双阈值）→ 漂移过滤 → 追加 + 指标累加
   * @returns {object|null} 新点或 null（被过滤）
   */
  addPoint(loc) {
    if (this.paused || !loc) return null;

    // 精度过滤：accuracy 超阈值（按类型，室内/弱信号）直接丢弃，避免轨迹乱跳
    if (typeof loc.accuracy === 'number' && loc.accuracy > this._typeCfg.maxAccuracyM) return null;

    // 防御：模拟器/部分机型 timestamp 可能是字符串，统一转数字
    const now = Number(loc.timestamp) || this.now();

    // 后台恢复预热：回前台后短时间内 GPS 冷启动漂移大，丢弃窗口内的点（等重新收敛）
    if (this._resumeWarmupUntil && this.now() < this._resumeWarmupUntil) return null;

    if (this.lastPoint) {
      const d = haversine(this.lastPoint, loc);
      const dt = (now - this.lastSampleTime) / 1000;
      // 时间/距离双阈值节流（F9：位置未变不重复采点）
      if (d < MIN_DISTANCE_M && dt < MIN_INTERVAL_MS / 1000) return null;
      // 漂移过滤：瞬时速度超阈值
      if (dt > 0 && d / dt > this._typeCfg.maxAbsSpeed) return null;
      // 反转漂移过滤：GPS 乱跳典型特征 = 方向大反转 + 低速（室内漂移来回弹）
      if (this.prevDirection != null && d >= MIN_DISTANCE_M) {
        const bearing = this._bearing(this.lastPoint, loc);
        let turn = Math.abs(bearing - this.prevDirection) % 360;
        if (turn > 180) turn = 360 - turn;
        const speed = dt > 0 ? d / dt : 0;
        if (turn > REVERSE_TURN_DEG && speed < REVERSE_SLOW_SPEED_MPS) {
          // 丢弃该点，但不更新方向（避免连续误杀后方向丢失）
          return null;
        }
        this.prevDirection = bearing;
      }
    }

    const point = {
      seq: ++this.seq,
      lat: loc.latitude,
      lng: loc.longitude,
      altitude: typeof loc.altitude === 'number' ? Math.round(loc.altitude * 10) / 10 : null,
      speed:
        loc.speed != null && loc.speed >= 0 ? Math.round(loc.speed * 10) / 10 : null,
      accuracy: typeof loc.accuracy === 'number' ? Math.round(loc.accuracy) : null,
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

    // 暂停恢复后首个被接受的点 → 标记 pauseGap（过滤掉的点不消耗标记）
    if (this._pendingGap) {
      point.pauseGap = true;
      this._pendingGap = false;
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

    // 尖刺回滚（决策：GPS 短时高速来回跳）——检测上一点是否尖刺，是则剔除并回退距离
    if (this.points.length >= 3 && this._recentSpeeds.length >= 3) {
      const a = this.points[this.points.length - 3];
      const b = this.points[this.points.length - 2];
      const d1 = haversine(a, b);
      const d2 = haversine(b, point);
      const dt1 = (b.timestamp - a.timestamp) / 1000;
      const dt2 = (point.timestamp - b.timestamp) / 1000;
      if (dt1 > 0 && dt2 > 0) {
        const v1 = d1 / dt1;
        const v2 = d2 / dt2;
        const med = this._recentSpeeds.slice().sort((x, y) => x - y)[Math.floor(this._recentSpeeds.length / 2)];
        const spikeV = Math.max(this._typeCfg.minSpikeSpeed, med * 4);
        if (v1 > spikeV && v2 > spikeV && this._turnAngle(a, b, point) > 110) {
          // 剔除 b：距离重算（去掉 a→b、b→c，改用 a→c）；爬升回退 b 段
          this.distance = Math.max(0, this.distance - d1 - d2 + haversine(a, point));
          if (b.altitude != null && a.altitude != null && b.altitude - a.altitude > CLIMB_DEAD_ZONE_M) {
            this.elevationGain = Math.max(0, this.elevationGain - (b.altitude - a.altitude));
          }
          this.points.pop();
          this.points.pop();
          this.points.push(point);
          this.lastPoint = point;
        }
      }
    }

    // 局部速度窗口（最近 6 个瞬时速度，尖刺判定用）
    if (this.points.length >= 2) {
      const prev = this.points[this.points.length - 2];
      const dt = (point.timestamp - prev.timestamp) / 1000;
      if (dt > 0) {
        this._recentSpeeds.push(haversine(prev, point) / dt);
        if (this._recentSpeeds.length > 6) this._recentSpeeds.shift();
      }
    }

    return point;
  }

  /** 方向转角（度，0~180） */
  _turnAngle(a, b, c) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const toDeg = (rad) => (rad * 180) / Math.PI;
    const br = (p, q) => {
      const y = Math.sin(toRad(q.lng - p.lng)) * Math.cos(toRad(q.lat));
      const x =
        Math.cos(toRad(p.lat)) * Math.sin(toRad(q.lat)) -
        Math.sin(toRad(p.lat)) * Math.cos(toRad(q.lat)) * Math.cos(toRad(q.lng - p.lng));
      return Math.atan2(y, x);
    };
    let turn = Math.abs(toDeg(br(a, b)) - toDeg(br(b, c))) % 360;
    if (turn > 180) turn = 360 - turn;
    return turn;
  }

  /** 方位角（度，0=北，顺时针） */
  _bearing(a, b) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const toDeg = (rad) => (rad * 180) / Math.PI;
    const lat1 = toRad(a.latitude != null ? a.latitude : a.lat);
    const lat2 = toRad(b.latitude != null ? b.latitude : b.lat);
    const dLng = toRad((b.longitude != null ? b.longitude : b.lng) - (a.longitude != null ? a.longitude : a.lng));
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  /**
   * 恢复现场（退出页面后重新进入）：从后端已上传的点重建状态
   * @param {Array} points 后端 trackPoints [{seq,lat,lng,altitude,speed,accuracy,timestamp}]
   */
  restoreFromPoints(points, markers, startTime, pausedMs) {
    this.points = (points || []).map((p) => ({ ...p }));
    this.markers = markers || [];
    this.seq = this.points.length ? this.points.reduce((m, p) => Math.max(m, p.seq || 0), 0) : 0;
    this.startTime = startTime || this.startTime;
    this.pausedMs = pausedMs || 0;
    // 指标从点重算（比信任旧值更准）
    this.distance = 0;
    this.elevationGain = 0;
    this.maxAltitude = null;
    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      if (p.altitude != null) {
        this.maxAltitude = this.maxAltitude == null ? p.altitude : Math.max(this.maxAltitude, p.altitude);
      }
      if (i > 0) {
        const prev = this.points[i - 1];
        this.distance += haversine(prev, p);
        if (p.altitude != null && prev.altitude != null && p.altitude - prev.altitude > CLIMB_DEAD_ZONE_M) {
          this.elevationGain += p.altitude - prev.altitude;
        }
      }
    }
    this.lastPoint = this.points.length ? this.points[this.points.length - 1] : null;
    this.lastSampleTime = this.lastPoint ? this.lastPoint.timestamp : 0;
    this.paused = false;
    this.pausedAt = 0;
    this._pendingGap = false;
  }

  /** 切后台标记（页面 onHide 调用） */
  markBackground() {
    this._backgroundAt = this.now();
  }

  /** 回前台（页面 onShow 调用）：后台较久且后台期间无采点（前台定位被暂停、GPS 冷启动）才预热 */
  onForeground() {
    const bgAt = this._backgroundAt;
    this._backgroundAt = 0;
    if (!bgAt) return;
    const bgMs = this.now() - bgAt;
    // 后台期间仍持续采点（后台定位可用）→ GPS 未冷启动，无需预热
    const hadPointsInBackground = this.lastSampleTime > bgAt;
    if (!hadPointsInBackground && bgMs > BACKGROUND_GAP_MS) {
      this._resumeWarmupUntil = this.now() + RESUME_WARMUP_MS;
    }
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
      // 恢复后的首个有效点带 pauseGap 标记（入库 + 渲染断开连线）
      this._pendingGap = true;
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

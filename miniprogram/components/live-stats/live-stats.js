/**
 * live-stats 实时数据面板
 * props: distanceKm, durationText, paceText, altitude, climb, calories, paused
 */
Component({
  properties: {
    distanceKm: { type: String, value: '0.00' },
    durationText: { type: String, value: '00:00' },
    paceText: { type: String, value: '—' },
    /** 当前海拔（GPS 参考值，可为 null） */
    altitude: { type: Number, value: null },
    climb: { type: Number, value: 0 },
    calories: { type: Number, value: 0 },
    paused: { type: Boolean, value: false },
  },
});

/**
 * 「不算配速」的运动类型（与服务端 sport_track_api/src/utils/pace.ts 的 NO_PACE_TYPES 同义）
 * - 游泳/骑行的速度口径（水中划频、车轮转速）与跑步配速不可比：实时配速、最快 1km、年度最快配速都不看
 * - 只此一处定义：新增第四种类型时改这里，全部调用点自动跟随，不会各自漂移
 */
const NO_PACE_TYPES = Object.freeze(['swimming', 'cycling']);

/** 该运动类型是否根本不看配速（入参允许 null/undefined/任意字符串：历史数据不受枚举约束） */
function hasNoPace(type) {
  return NO_PACE_TYPES.includes(type);
}

module.exports = {
  NO_PACE_TYPES,
  hasNoPace,
};

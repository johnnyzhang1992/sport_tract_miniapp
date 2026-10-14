/**
 * 个人最佳匹配（口径与服务端 /stats/best 一致，轨迹详情页徽章 / 轨迹列表角标共用）
 * 各榜单取该运动类型第一名记录，记录 id 与本轨迹相等即命中：
 * 最远距离 maxDistanceByType / 最快配速 minPaceByType（取 fastestKm，本轨迹自身成绩）/
 * 最长时长 maxDurationByType（取运动时长）/ 最大爬升 maxElevationByType（有爬升才参与）/
 * 距离里程碑 fastestDistanceByKm（5/10/15…公里 PB：本轨迹 pbMarks 与榜单按 (type, km) 对上且 id 相等）
 */
const { formatDuration, formatPaceParts } = require('./format');

/**
 * @param {{id:string, type:string, distance:number, fastestKm:number, duration:number, elevationGain:number, pbMarks:Array}} activity
 * @param {{maxDistanceByType:Array,minPaceByType:Array,maxDurationByType:Array,maxElevationByType:Array,fastestDistanceByKm:Array}|null} best
 * @returns {Array<{label:string,value:string,unit:string}>} 命中的最佳项（可多项），未命中/无数据为 []
 */
function matchBest(activity, best) {
  if (!activity || !best) return [];
  const id = String(activity.id || '');
  if (!id) return [];
  const paceParts = formatPaceParts(activity.fastestKm);
  const rows = [
    {
      list: best.maxDistanceByType,
      label: '最远距离',
      value: ((activity.distance || 0) / 1000).toFixed(2),
      unit: '公里',
    },
    paceParts && {
      list: best.minPaceByType,
      label: '最快配速',
      value: paceParts.value,
      unit: paceParts.unit,
    },
    {
      list: best.maxDurationByType,
      label: '最长时长',
      value: formatDuration(activity.duration),
      unit: '',
    },
    (activity.elevationGain || 0) > 0 && {
      list: best.maxElevationByType,
      label: '最大爬升',
      value: String(activity.elevationGain),
      unit: '米',
    },
  ].filter(Boolean);
  const hits = [];
  for (const { list, label, value, unit } of rows) {
    const rec = (list || []).find((r) => r.type === activity.type);
    if (rec && String(rec.id) === id) hits.push({ label, value, unit });
  }
  // 距离里程碑 PB：保持者链（达成即终身持有——已被刷新的前纪录也命中，former 标记灰显；
  // 旧版服务端无链时退回 fastestDistanceByKm，全部按当前纪录处理）
  const chain = best.distancePbChain || (best.fastestDistanceByKm || []).map((r) => ({ ...r, isCurrent: true }));
  (activity.pbMarks || []).forEach((mark) => {
    if (!mark || !mark.km) return;
    const rec = chain.find(
      (r) => r.type === activity.type && Number(r.km) === Number(mark.km) && String(r.id) === id,
    );
    if (rec) {
      hits.push({
        label: `${mark.km} 公里 PB`,
        value: formatDuration(mark.sec),
        unit: '',
        former: !rec.isCurrent,
        heldText: heldText(rec.heldDays),
      });
    }
  });
  return hits;
}

/** 保持天数展示：0 天不展示（刚达成），1+ =「保持N天」，缺数据不显示 */
function heldText(days) {
  const d = Number(days);
  if (!Number.isFinite(d) || d <= 0) return '';
  return `保持${d}天`;
}

module.exports = { matchBest };

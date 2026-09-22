/**
 * 统计页「省份 → 城市」列表的纯函数：把接口返回的 provinces（含 cities）换算成可渲染的行视图。
 *
 * 为什么要抽出来：WXML 既算不出「这一行是否展开」，也没法给缺失字段兜底，
 * 而展开态是页面 data 里的一份省份名集合，每次切换都要整表重算——留在页面里就成了不可测的胶水。
 * 排序不在这里做：接口已按足迹数倒序（与地图着色同一口径），前端重排会让两处对不上。
 */

/** @param provinces 接口 provinces：[{name, count, cities:[{name,count}]}]；@param expanded 展开中的省份名数组 */
function buildRegionRows(provinces, expanded) {
  const open = Array.isArray(expanded) ? expanded : [];
  return (Array.isArray(provinces) ? provinces : [])
    .filter((p) => p && p.name)
    .map((p) => {
      const cities = (Array.isArray(p.cities) ? p.cities : []).filter((c) => c && c.name);
      return {
        name: p.name,
        count: Number(p.count) || 0,
        cities,
        cityCount: cities.length,
        expandable: cities.length > 0, // 早期直连库灌的数据有省无市，不给展开箭头
        // 展开态只在「有城市可看」时成立：否则点到无市的省会亮起高亮却展不出任何行
        expanded: cities.length > 0 && open.indexOf(p.name) >= 0,
      };
    });
}

/** 切换某省的展开态，返回新数组（页面 setData 需要新引用） */
function toggleRegion(expanded, name) {
  const list = Array.isArray(expanded) ? expanded : [];
  const i = list.indexOf(name);
  if (i < 0) return list.concat(name);
  return list.slice(0, i).concat(list.slice(i + 1));
}

/** 标题右侧的「共 N 省 M 城」：市数是各省城市之和（接口 cityCount 按省|市去重，两者同源等价） */
function regionSummaryText(provinces) {
  const list = Array.isArray(provinces) ? provinces : [];
  let cityCount = 0;
  for (const p of list) cityCount += Array.isArray(p && p.cities) ? p.cities.length : 0;
  return `共 ${list.length} 省 ${cityCount} 城`;
}

module.exports = { buildRegionRows, toggleRegion, regionSummaryText };

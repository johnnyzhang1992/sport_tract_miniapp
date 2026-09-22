/**
 * 足迹地图页筛选的纯函数：候选项计算 + query 参数拼装 + 生效判定。
 *
 * 为什么候选项在前端算：/footprint-records/geo 本来就是全量拉取（地图要一次拿齐才能算聚合与 fitBounds），
 * 省份/年份候选直接从这份快照去重计数即可，不必再开一个聚合接口。
 * 前提是页面自己留一份「未过滤快照」——过滤后的结果集算候选会让选过的省份从列表里消失，改不回去。
 */

/** visitDate 是 YYYY-MM-DD 字符串（服务端 zod 已保证），取前 4 位当年份 */
function yearOf(visitDate) {
  const y = Number(String(visitDate || '').slice(0, 4));
  return Number.isFinite(y) && String(y).length === 4 ? y : 0;
}

/**
 * @param records 未过滤的全量点集（/geo item：province/city/category/visitDate）
 * @param categoryOrder 分类 key 的展示顺序（页面 config 里那份），不传则按计数倒序
 */
function buildFilterOptions(records, categoryOrder) {
  const provMap = new Map();
  const yearMap = new Map();
  const catMap = new Map();
  for (const r of records || []) {
    if (r.province) provMap.set(r.province, (provMap.get(r.province) || 0) + 1);
    const y = yearOf(r.visitDate);
    if (y) yearMap.set(y, (yearMap.get(y) || 0) + 1);
    if (r.category) catMap.set(r.category, (catMap.get(r.category) || 0) + 1);
  }
  const provinces = [...provMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
  const years = [...yearMap.entries()]
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => b.year - a.year);
  const order = Array.isArray(categoryOrder) && categoryOrder.length ? categoryOrder : null;
  const categories = [...catMap.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) =>
      order ? order.indexOf(a.key) - order.indexOf(b.key) : b.count - a.count || a.key.localeCompare(b.key),
    );
  return { provinces, years, categories };
}

/** 只把非空项拼进 query；year 转字符串，与接口 ?year=2024 的形态一致 */
function buildGeoQuery(state) {
  const s = state || {};
  const keyword = (s.keyword || '').trim();
  const q = {};
  if (s.province) q.province = s.province;
  if (s.year) q.year = String(s.year);
  if (s.category) q.category = s.category;
  if (keyword) q.keyword = keyword;
  return q;
}

/** 筛选弹窗里的三项才算「筛选中」；关键词是搜索，不点亮筛选按钮 */
function activeFilterCount(state) {
  const s = state || {};
  return [s.province, s.year, s.category].filter(Boolean).length;
}

function hasActiveFilter(state) {
  return activeFilterCount(state) > 0;
}

/**
 * 省级单位 → chip 上显示的短名（34 个省级单位全量对照，不靠剥后缀猜）。
 * 键必须与库里 `location.province` 的写法一致（服务端 locateRegion 返回的是全称，如「新疆维吾尔自治区」）。
 */
const PROVINCE_SHORT_NAMES = {
  北京市: '北京',
  天津市: '天津',
  河北省: '河北',
  山西省: '山西',
  内蒙古自治区: '内蒙古',
  辽宁省: '辽宁',
  吉林省: '吉林',
  黑龙江省: '黑龙江',
  上海市: '上海',
  江苏省: '江苏',
  浙江省: '浙江',
  安徽省: '安徽',
  福建省: '福建',
  江西省: '江西',
  山东省: '山东',
  河南省: '河南',
  湖北省: '湖北',
  湖南省: '湖南',
  广东省: '广东',
  广西壮族自治区: '广西',
  海南省: '海南',
  重庆市: '重庆',
  四川省: '四川',
  贵州省: '贵州',
  云南省: '云南',
  西藏自治区: '西藏',
  陕西省: '陕西',
  甘肃省: '甘肃',
  青海省: '青海',
  宁夏回族自治区: '宁夏',
  新疆维吾尔自治区: '新疆',
  香港特别行政区: '香港',
  澳门特别行政区: '澳门',
  台湾省: '台湾',
};

/**
 * 筛选弹窗 chip 的省份短名；表里没有的原样显示（脏数据/将来的新写法宁可占宽一点也不截错字）。
 * 只用于显示——回传给 /geo 的 province 仍是全名，要和库里 location.province 精确匹配。
 */
function shortProvinceName(name) {
  const full = String(name || '');
  return PROVINCE_SHORT_NAMES[full] || full;
}

module.exports = {
  buildFilterOptions,
  buildGeoQuery,
  hasActiveFilter,
  activeFilterCount,
  shortProvinceName,
  PROVINCE_SHORT_NAMES, // 导出给测试钉住「34 个省级单位全覆盖」
};

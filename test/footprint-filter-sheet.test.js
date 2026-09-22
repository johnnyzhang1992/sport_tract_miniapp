/**
 * components/footprint-filter-sheet 回归：半屏筛选弹窗的草稿态与事件。
 * 桩：Component() 捕获定义（与 footprint-detail-sheet.test.js 同一套路）；不依赖 wx。
 * 运行：npm test（node --test 自动发现）；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

global.Component = (def) => { global.__def = def; };
global.wx = {};
require('../miniprogram/components/footprint-filter-sheet/footprint-filter-sheet.js');
const def = global.__def;
assert.ok(def, 'footprint-filter-sheet.js 应通过 Component() 交出组件对象');

const OPTIONS = {
  provinces: [
    { name: '浙江省', count: 3 },
    { name: '陕西省', count: 1 },
    { name: '新疆维吾尔自治区', count: 2 },
    { name: '黑龙江省', count: 2 },
  ],
  years: [{ year: 2025, count: 2 }, { year: 2024, count: 4 }],
  categories: [{ key: 'scenic', count: 2 }, { key: 'mountain', count: 5 }],
};
const CATEGORIES = [
  { key: 'scenic', label: '景区' },
  { key: 'mountain', label: '山峰' },
  { key: 'park', label: '公园绿地' },
];

function mount(value, options) {
  const c = Object.assign({}, def.methods);
  c.data = JSON.parse(JSON.stringify(def.data));
  c.events = [];
  c.setData = (patch) => Object.assign(c.data, patch);
  c.triggerEvent = (name, detail) => c.events.push({ name, detail });
  c.properties = { value, options, categories: CATEGORIES };
  def.observers['visible, value, options'].call(c, true, value, options);
  return c;
}
const section = (c, field) => c.data.sections.find((s) => s.field === field);

test('S1 打开时按当前筛选回填三段 chips，每段以「全部」开头', () => {
  const c = mount({ province: '陕西省', year: 2024, category: 'scenic' }, OPTIONS);
  assert.deepEqual(c.data.sections.map((s) => s.field), ['province', 'year', 'category']);
  assert.equal(section(c, 'province').items[0].key, '');
  assert.equal(section(c, 'province').items[0].label, '全部');
  assert.equal(section(c, 'province').items[1].active, false);
  assert.equal(section(c, 'province').items[2].active, true, '陕西省 应为选中态');
  assert.equal(section(c, 'year').items.find((i) => i.key === '2024').active, true);
  assert.equal(section(c, 'category').items.find((i) => i.key === 'scenic').active, true);
});

test('S2 文案：省份 chip 只显示前两字（key 仍是全名）、年份带「年」、分类用 config 的中文名与图标、计数随项下发', () => {
  const c = mount({}, OPTIONS);
  const prov = section(c, 'province').items;
  assert.deepEqual(prov.map((i) => i.label), ['全部', '浙江', '陕西', '新疆', '黑龙江'], '剥掉行政后缀后的短名（字面截两字会出「黑龙」这种破词）');
  assert.deepEqual(
    prov.map((i) => i.key),
    ['', '浙江省', '陕西省', '新疆维吾尔自治区', '黑龙江省'],
    '回传给 /geo 的仍是接口认的全名，短写只是显示层',
  );
  assert.equal(prov[3].count, 2, '计数跟着短名一起显示');
  assert.equal(section(c, 'year').items[1].label, '2025 年');
  const scenic = section(c, 'category').items.find((i) => i.key === 'scenic');
  assert.equal(scenic.label, '景区');
  assert.equal(scenic.icon, '/assets/icons/fp-cat-scenic.png');
  assert.equal(scenic.count, 2);
  assert.equal(section(c, 'category').items.find((i) => i.key === 'park'), undefined, '没有足迹的分类不进候选');
});

test('S3 chips 是草稿：再点选中项取消、切换不影响已生效筛选，确定才回传', () => {
  const c = mount({ province: '浙江省' }, OPTIONS);
  c.onChipTap({ currentTarget: { dataset: { field: 'year', key: '2025' } } });
  assert.equal(c.events.length, 0, '选 chips 不该直接抛事件');
  assert.equal(c.data.draft.year, '2025', '草稿里的年份是字符串（chip 的 key 口径）');
  c.onChipTap({ currentTarget: { dataset: { field: 'year', key: '2025' } } });
  assert.equal(c.data.draft.year, '', '再点一次取消该段筛选');
  c.onChipTap({ currentTarget: { dataset: { field: 'province', key: '陕西省' } } });
  c.onConfirm();
  assert.deepEqual(c.events[0], { name: 'confirm', detail: { province: '陕西省', year: '', category: '' } });
});

test('S4 重置清空草稿但不立即生效（仍要点确定）', () => {
  const c = mount({ province: '浙江省', category: 'mountain' }, OPTIONS);
  c.onReset();
  assert.deepEqual(c.data.draft, { province: '', year: '', category: '' });
  assert.equal(c.events.length, 0);
  assert.equal(section(c, 'province').items[0].active, true, '重置后「全部」应立刻高亮');
});

test('S5 无数据：三段只剩「全部」并给出原因文案', () => {
  const c = mount({}, { provinces: [], years: [], categories: [] });
  assert.equal(c.data.empty, true);
  assert.deepEqual(section(c, 'province').items.map((i) => i.key), ['']);
});

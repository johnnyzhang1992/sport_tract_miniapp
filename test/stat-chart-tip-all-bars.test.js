/**
 * 全部柱状图都必须开「点柱看数」（2026-11-10）：
 * 组件本身支持 show-tip，但每个页面的开关要逐处打开——漏一个用户就点不出数据。
 * 本测试扫描所有 wxml 里的 <stat-chart>，凡是柱状（type="bar" / "grouped-bar"）都必须带 show-tip。
 * 运行：node --test test/stat-chart-tip-all-bars.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'miniprogram');

function walkWxml(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'miniprogram_npm' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkWxml(full));
    else if (entry.name.endsWith('.wxml')) out.push(full);
  }
  return out;
}

/** 取出所有 <stat-chart .../> 标签（可能跨行） */
function statChartTags(source) {
  return source.match(/<stat-chart[\s\S]*?\/>/g) || [];
}

test('TIP-ALL：所有柱状图（bar / grouped-bar）都开启了 show-tip', () => {
  const missing = [];
  let bars = 0;
  for (const file of walkWxml(ROOT)) {
    const rel = path.relative(ROOT, file);
    for (const tag of statChartTags(fs.readFileSync(file, 'utf8'))) {
      const flat = tag.replace(/\s+/g, ' ');
      const isBar = /type="(bar|grouped-bar)"/.test(flat);
      if (!isBar) continue;
      bars += 1;
      // show-tip="{{true}}" 或 show-tip="true" 都算开启
      if (!/show-tip="(\{\{\s*true\s*\}\}|true)"/.test(flat)) {
        missing.push(`${rel}: ${flat.slice(0, 110)}`);
      }
    }
  }
  assert.equal(missing.length, 0, `以下柱状图缺少 show-tip：\n${missing.join('\n')}`);
  assert.ok(bars >= 7, `应当至少扫描到 7 个柱状图，实际 ${bars} 个（正则/目录可能失效）`);
});

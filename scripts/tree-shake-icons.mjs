#!/usr/bin/env node
/**
 * tree-shake-icons.mjs — 按需裁剪 tdesign-miniprogram 的 icon.wxss
 *
 * 背景：tdesign-miniprogram 的 t-icon 组件被 cell/button/tabs 等组件隐式依赖，
 * 小程序机制下组件 wxss 会全量加载，icon.wxss（~112KB / 2352 个图标类）全部进包。
 * 本脚本扫描项目业务代码里实际用到的图标（t-icon-xxx 类名 / <t-icon name="xx">），
 * 只保留这些图标对应的 :before 规则 + 基础样式，其余删除。
 *
 * 用法：
 *   node scripts/tree-shake-icons.mjs            # 自动扫描 + 裁剪（默认覆盖写回）
 *   node scripts/tree-shake-icons.mjs --dry-run  # 只预览，不写文件
 *   node scripts/tree-shake-icons.mjs --icons home,close  # 额外手动保留的图标
 *
 * 注意：
 *   1. 微信开发者工具每次点“构建 npm”都会重新拷贝 node_modules 里的 tdesign-miniprogram，
 *      因此构建后需要重跑本脚本（建议接到 CI / postinstall）。
 *   2. 动态绑定的图标（<t-icon name="{{xxx}}">）无法静态识别，若确实在用，请用 --icons 手动补充，
 *      本脚本会对扫描到的动态 name 给出警告。
 *   3. 自定义 prefix（<t-icon prefix="my">）不在处理范围，默认 classPrefix 为 t。
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC_DIR = join(ROOT, 'miniprogram');
const ICON_WXSS = join(SRC_DIR, 'miniprogram_npm', 'tdesign-miniprogram', 'icon', 'icon.wxss');
const LIB_DIR = join(SRC_DIR, 'miniprogram_npm', 'tdesign-miniprogram'); // 组件库构建产物
const SCAN_EXTS = new Set(['.wxml', '.js', '.ts', '.json', '.wxss']);

// ---------- CLI 参数 ----------
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const iconsArg = args.find((a) => a.startsWith('--icons='))?.split('=')[1] ?? '';

// ---------- 1. 扫描业务代码中的图标用量 ----------
function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'miniprogram_npm') continue; // 跳过组件库产物
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, files);
    else if (SCAN_EXTS.has(extname(full))) files.push(full);
  }
  return files;
}

const files = walk(SRC_DIR);
const used = new Set();
const dynamic = new Set(); // 无法静态识别的动态 name
const NAME_RE = /^[a-z][a-z0-9-]*$/;

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  // t-icon-xxx 类名用法（wxml 硬编码类 / js、wxss 里的字符串）
  for (const m of text.matchAll(/\bt-icon-([a-z0-9-]+)/g)) used.add(m[1]);
  // <t-icon ... name="xx" /> 组件用法
  for (const m of text.matchAll(/<t-icon\b[^>]*\bname="([^"]+)"/g)) {
    const v = m[1];
    if (NAME_RE.test(v)) used.add(v);
    else dynamic.add(`${file.split(ROOT)[1]}: name="${v}"`);
  }
}

// ---------- 1.1 组件库内部的硬编码图标 ----------
// 业务代码扫不到的隐藏使用：popup/dialog/image 的 close、cell arrow 的 chevron-right 等。
// 自动从 miniprogram_npm 构建产物提取（wxml 静态 name + js 默认参数），组件库升级后同样有效。
const libFiles = walk(LIB_DIR).filter((f) => /\.(wxml|js)$/.test(f));
const libUsed = new Set();
for (const file of libFiles) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/<t-icon\b[^>]*\bname="([a-z0-9-]+)"/g)) libUsed.add(m[1]);
  for (const m of text.matchAll(/(?:calcIcon|setIcon)\([^)]*,\s*"([a-z0-9-]+)"/g)) libUsed.add(m[1]);
}
for (const n of libUsed) used.add(n);
// 手动白名单
for (const n of iconsArg.split(',').map((s) => s.trim()).filter(Boolean)) used.add(n);

// ---------- 2. 裁剪 icon.wxss ----------
if (!existsSync(ICON_WXSS)) {
  console.error(`✗ 找不到 ${ICON_WXSS}`);
  console.error('  请先在微信开发者工具里执行一次“构建 npm”，再运行本脚本。');
  process.exit(1);
}

const original = readFileSync(ICON_WXSS, 'utf8');
const RESULT_RE = /^\.t-icon-([a-z0-9-]+):before\{[^}]*\}\s*$/gm;

// 按行裁剪：整行删除未使用图标规则，保留基础样式；再合并残留空行
let kept = 0;
let removed = 0;
const keptNames = [];
const trimmed = original
  .replace(RESULT_RE, (rule, name) => {
    if (used.has(name)) {
      kept++;
      keptNames.push(name);
      return rule;
    }
    removed++;
    return '';
  })
  .replace(/^\s*\n/gm, '')
  .trimEnd() + '\n';

if (!dryRun) writeFileSync(ICON_WXSS, trimmed, 'utf8');

const origKB = (original.length / 1024).toFixed(1);
const newKB = (trimmed.length / 1024).toFixed(1);

console.log(`扫描文件: ${files.length} 个 (${SRC_DIR})`);
console.log(`├─ 业务代码图标: ${[...used].filter((n) => !libUsed.has(n)).length} 个`);
if (libUsed.size) console.log(`├─ 组件库内部图标: ${[...libUsed].sort().join(', ')}（自动提取，不可删）`);
console.log(`├─ 保留清单(${used.size}): ${[...used].sort().join(', ') || '（无）'}`);
if (dynamic.size) {
  console.log(`├─ ⚠️ 动态 name 无法静态识别，若在用请 --icons 手动补充:`);
  for (const d of dynamic) console.log(`│    ${d}`);
}
console.log(`├─ 裁剪结果: 保留 ${kept} 个图标类，删除 ${removed} 个`);
console.log(`├─ icon.wxss: ${origKB} KB → ${newKB} KB  (${((newKB / origKB) * 100).toFixed(1)}%)`);
if (dryRun) {
  console.log('└─ --dry-run 模式，未写文件。');
} else {
  console.log(`└─ 已写回 ${ICON_WXSS}`);
  console.log('   ⚠️ 重新构建组件库（微信开发者工具“构建 npm”/ scripts/build-tdesign.sh）后需重跑本脚本；');
}
console.log(`   保留的图标: ${keptNames.sort().join(', ') || '（仅基础样式，无任何图标类）'}`);
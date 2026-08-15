#!/bin/bash
# 按需构建 echarts（仅地图相关模块），输出到点亮地图分包
# 背景：echarts 全量 996KB，按需后约 496KB（分包体积优化）
# 用法：bash scripts/build-echarts.sh
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$ROOT/.echarts-build"
OUT="$ROOT/miniprogram/packageFootprint/components/ec-canvas/echarts.js"

mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

# 首次安装依赖（目录名带 . 前缀，npm init 会因包名非法失败，直接 npm i 自动生成 package.json）
if [ ! -d node_modules ]; then
  echo "安装构建依赖（echarts/rollup/terser）..."
  npm i echarts@5 rollup @rollup/plugin-node-resolve @rollup/plugin-replace terser 2>&1 | tail -1
fi

# 按需入口：只注册地图相关模块（MapChart + Tooltip + VisualMap + Geo + Canvas）
cat > bundle-entry.js << 'EOF'
import * as echarts from 'echarts/core';
import { MapChart } from 'echarts/charts';
import { TooltipComponent, VisualMapComponent, GeoComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([MapChart, TooltipComponent, VisualMapComponent, GeoComponent, CanvasRenderer]);

export default echarts;
EOF

# rollup 配置：process.env.NODE_ENV 替换为 production（小程序无 process 全局，不替换会报错）
cat > rollup.config.mjs << 'EOF'
import { nodeResolve } from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';

export default {
  input: 'bundle-entry.js',
  output: { file: 'echarts.custom.js', format: 'umd', name: 'echarts' },
  plugins: [
    nodeResolve(),
    replace({
      preventAssignment: true,
      'process.env.NODE_ENV': JSON.stringify('production'),
    }),
  ],
};
EOF

npx rollup -c rollup.config.mjs >/dev/null 2>&1
npx terser echarts.custom.js -c -m -o echarts.custom.min.js
cp echarts.custom.min.js "$OUT"

echo "✅ echarts 按需构建完成：$(du -sh "$OUT" | cut -f1)（全量约 996KB，按需约 496KB）"

# 09 · echarts 按需构建说明

## 背景

点亮地图页使用 echarts 渲染中国地图，原引入的是 **echarts 全量包（996KB）**，其中大部分模块（柱状图、折线图、散点图等）都未使用。

通过**按需引入**（tree-shaking）只打包地图相关模块，体积从 **996KB 降到约 496KB**，点亮地图分包从 1.0MB 降到约 544KB。

## 如何重新构建

```bash
# 在项目根目录执行
bash scripts/build-echarts.sh
```

脚本会：
1. 在 `.echarts-build/` 临时目录安装依赖（echarts@5 / rollup / terser）
2. 生成按需入口（只注册地图模块）
3. rollup 打包 + terser 压缩
4. 输出到 `miniprogram/packageFootprint/components/ec-canvas/echarts.js`

> `.echarts-build/` 已加入 `.gitignore`，不会提交。

## 按需引入的模块

入口文件（`bundle-entry.js`）：

```js
import * as echarts from 'echarts/core';
import { MapChart } from 'echarts/charts';
import { TooltipComponent, VisualMapComponent, GeoComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([MapChart, TooltipComponent, VisualMapComponent, GeoComponent, CanvasRenderer]);
```

| 模块 | 用途 |
|---|---|
| `MapChart` | 地图（中国省市边界） |
| `TooltipComponent` | 省份点击提示（tooltip） |
| `VisualMapComponent` | 点亮色阶（深浅 = 次数） |
| `GeoComponent` | 地理坐标系（map 依赖） |
| `CanvasRenderer` | canvas 2d 渲染 |

## 常见问题

**Q：报 `process is not defined`？**
A：echarts 源码含 `process.env.NODE_ENV`（开发/生产判断），小程序无 `process` 全局。
脚本已在 rollup 配置里用 `@rollup/plugin-replace` 替换为 `'production'`，重新构建即可解决。

**Q：需要新增图表类型（如柱状图）？**
A：编辑 `scripts/build-echarts.sh` 里的 `bundle-entry.js`，追加对应的 chart/component 并 `use()` 注册，重新构建。

**Q：升级 echarts 版本？**
A：改脚本里的 `npm i echarts@5`（如 `echarts@5.5.0`），重新构建。注意验证 API 兼容性（init/registerMap/setPlatformAPI 等）。

## 体积对比

| 版本 | echarts.js | 分包 packageFootprint |
|---|---|---|
| 全量 | 996KB | 1.0MB |
| 按需 | ~496KB | ~544KB |

# sport_track_miniapp — 运动轨迹记录小程序（前端）

> 版本：v1.0（M1-M8 全功能：记录 / 地图 / 打点 / 统计 / 海报 / 合集 / 导入 / 纠偏）
> 文档：`docs/`（01 需求 / 02 竞品 / 03 前端架构 / 04 后端架构 / 05 上线准备 / 06 导入调研 / 07 纠偏调研 / 08 纠偏实现）

## 功能总览

| 模块 | 说明 |
|---|---|
| **运动记录** | 实时轨迹（GPS 采点/节流/漂移过滤/尖刺回滚）、实时数据面板（距离/时长/配速/海拔）、实时精度徽章、图层切换、暂停/继续/结束 |
| **打点** | 中途打卡（类型/备注/照片 ≤3 张）、打点序号图标（①②③）、照片增删、OSS 私有直传 |
| **轨迹详情** | 地图（分段轨迹、海拔着色、起点终点标记）、回放、海拔曲线、照片、轨迹信息编辑（类型/备注）、重新纠偏、GPX 导出（devtools 复制 / PC+真机文件） |
| **分享海报** | 先预览再保存/分享（Canvas 绘制：轨迹海拔着色 + 指标卡 + 品牌），朋友圈/朋友卡片封面 |
| **统计** | 距离趋势/时长/次数图表、数据统计页 |
| **轨迹合集** | 一周/一月/一年/全部一图总览（多轨迹 + 高频路线热力 + 全屏）、DP 抽稀 |
| **数据导入** | 两步路/Strava/佳明等 GPX/KML/TCX 导入，WGS-84→GCJ-02 坐标转换、类型/来源确认 |
| **轨迹列表** | 左滑删除（二次确认）、类型筛选、卡片展示 |
| **个人中心** | 资料编辑、数据导入入口、轨迹合集入口、设置、隐私政策 |

## 技术栈

- 微信小程序**原生**开发（不引入 Taro/uni-app）
- UI：**tdesign-miniprogram**（`miniprogram_npm` 构建产物，clone 后需重建）
- 地图：微信 `map` 组件（GCJ-02）
- 后端：`../sport_track_api/`（Fastify 5 + MongoDB，端口 3004，线上 api.historybook.cn）

## 关键设计

- **API 环境切换**：`config/index.js` 按 `wx.getAccountInfoSync().envVersion` 自动切（开发=本地 IP / 体验正式=线上域名），可 FORCE_ONLINE 强制
- **网络层**：JWT 注入 + 401 静默刷新重试 + uploadFile 同机制（DELETE 空 body 显式 text/plain 防后端 400）
- **轨迹纠偏**：前端实时（精度过滤/节流/速度/反转/尖刺回滚 + 距离回退）+ 后端 finish（海拔清洗→轨迹纠偏→平滑→重算），**按运动类型微调阈值**（详见 docs/08）
- **隐私合规**：定位权限 desc + requiredPrivateInfos、隐私政策页、启动隐私引导（getPrivacySetting）、内容安全检测
- **坐标系**：第三方导入 WGS-84 → GCJ-02 自动转换（与 eviltransform 标准一致）

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 微信开发者工具 → 导入项目 → 本目录（project.config.json 已配置）

# 3. 本地设置勾选"不校验合法域名"

# 4. 启动后端（见 ../sport_track_api/README.md）
cd ../sport_track_api && pnpm dev

# 5. 工具 → 构建 npm（tdesign 组件）
#    clone 后重建：cp -r node_modules/tdesign-miniprogram/miniprogram_dist miniprogram/miniprogram_npm/tdesign-miniprogram
```

## 目录结构

```
sport_track_miniapp/
├── project.config.json        # AppID wx68ebe78cca4dc17c + packOptions.ignore
├── docs/                      # 需求/架构/上线/导入/纠偏 文档
├── miniprogram/
│   ├── app.js                 # 静默登录 + 隐私引导 + 未保存运动恢复
│   ├── app.json               # 页面/tabBar/权限声明/requiredPrivateInfos
│   ├── config/index.js        # 配置中心（API/运动类型/颜色）
│   ├── services/
│   │   ├── api.js             # 网络层（401 刷新/uploadFile/buildUrl）
│   │   ├── tracker.js         # 运动记录器（采点/过滤/尖刺回滚/指标/seq）
│   │   ├── sync.js            # 增量上传协议
│   │   ├── oss-upload.js      # OSS 签名直传（私有 bucket）
│   │   ├── geo.js             # 逆地理编码（后端代理）
│   │   └── storage.js         # token/用户/设置缓存
│   ├── utils/format.js        # 时长/公里/配速（7'30"/公里）
│   ├── components/
│   │   ├── track-map/         # 地图组件（record/view/overview 三模式 + 海拔着色 + 起终点 + 回放）
│   │   ├── live-stats/        # 实时数据面板
│   │   ├── marker-form/       # 打点表单
│   │   ├── stat-chart/        # 统计图表（柱/折线 + 标注隔离）
│   │   └── share-card/        # 分享海报（预览/保存/分享）
│   └── pages/
│       ├── index/             # 首页（类型选择 + 今日概览 + 开始）
│       ├── record/            # 运动记录（实时地图 + 精度徽章 + 打点）
│       ├── summary/           # 运动摘要（保存）
│       ├── tracks/            # 轨迹列表（左滑删除 + 卡片）
│       ├── track-detail/      # 详情（地图/回放/海拔/编辑/纠偏/导出）
│       ├── stats/             # 数据统计
│       ├── overview/          # 轨迹合集（多轨迹 + 热力 + 全屏）
│       ├── import/            # 数据导入（GPX/KML/TCX + 来源/类型确认）
│       ├── profile/settings/privacy
│       └── my/                # 我的（资料/合集/导入/统计/设置入口）
```

## 里程碑

- [x] M1 骨架：tabBar、静默登录、网络层、轨迹列表
- [x] M2 记录：实时采点/过滤/指标/增量上传/打点/摘要保存
- [x] M3 详情：地图（分段/回放/图层/全屏/海拔曲线/照片）
- [x] M4 分享海报（预览/保存/分享/海拔着色）、统计图表、资料/设置
- [x] M5 隐私合规、上线准备（docs/05）
- [x] M6 轨迹合集（一周/一月/一年 + 热力 + 抽稀）
- [x] M7 数据导入（GPX/KML/TCX + 坐标转换 + 来源记录）、轨迹信息编辑、删除
- [x] M8 轨迹纠偏（四类剔除 + 首尾跳 + 类型化阈值 + 实时尖刺回滚 + reprocess）
- [ ] 体验版/正式版发布（合法域名 + 提审）

## 上线待办（详见 docs/05）

1. 微信后台：服务器域名（request `api.historybook.cn`；uploadFile/downloadFile OSS；downloadFile tdesign.gtimg.com）
2. 用户隐私保护指引（位置/相册/昵称头像）
3. 服务类目「运动健身」；上传体验版 → 真机回归 → 提审
4. 证书续期：historybook.cn / myhistorybook.cn（2026-09 到期）

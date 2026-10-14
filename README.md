<div align="center">

<img src="miniprogram/assets/logo.png" width="96" alt="小迹一下" />

<h1>小迹一下 — 运动轨迹记录小程序</h1>

<p><b>微信扫一扫，体验完整功能</b></p>

<img src="miniprogram/assets/app_code.jpg" width="200" alt="小程序码" />

</div>

> 版本：v1.2（记录 / 地图 / 打点 / 统计 / 最佳记录 / 海报 / 合集 / 导入 / 纠偏 / 点亮地图 / 体重管理）

## 功能总览

| 模块 | 说明 |
|---|---|
| **运动记录** | 实时轨迹（GPS 采点/节流/漂移过滤/尖刺回滚）、实时数据面板（距离/时长/配速/海拔/卡路里）、精度徽章、图层切换、暂停/继续/结束、**后台定位**（切后台持续记录）、运动中退出自动暂停（首页继续入口） |
| **打点** | 中途打卡（类型/备注/照片 ≤3 张）、打点序号图标、照片增删、OSS 私有直传 |
| **轨迹详情** | 地图（分段轨迹、海拔着色、起点终点标记、**双指旋转**）、回放、海拔曲线、照片、轨迹信息编辑（类型/备注）、**用户自主纠偏**（原始点落库，纠偏按钮区分已/未纠偏）、GPX 导出、**最佳记录徽章**（穗枝 + 成绩，前纪录灰显 + 保持天数） |
| **分享海报** | 浅色风格（白底黑字/轨迹单色细线）、预览/保存/分享 |
| **统计** | 距离趋势/时长/次数图表、数据统计页、**最佳记录横滑卡片**（穗枝环图标，距离PB在前） |
| **运动报告** | 周/月/年汇总 + **最佳记录横滑卡片** + 轨迹记录 + 周期海报 |
| **最佳记录** | 4 项指标（最远距离/最快配速/最长时长/最大爬升，按运动类型分榜）+ **距离里程碑 PB**（5 公里 PB / 10 公里 PB / 每 5km 步进），保持者链含**前纪录终身持有 + 保持天数** |
| **轨迹合集** | 一周/一月/一年/全部一图总览（多轨迹 + 高频路线热力 + 全屏）、**分享弹窗**（自适应网格海报/最多72条/时间开关）、最近轨迹卡片化（分批渲染） |
| **点亮地图** | 真实中国地图（echarts 按需引入）+ 离线省市定位，足迹点亮（省/市数）、缩放/拖拽/+/- 按钮、全屏 |
| **运动日历** | 首页 GitHub 风格热力图（近 365 天，颜色深浅=运动量） |
| **体重管理** | 身高/体重录入（卡路里用实际体重）、体重趋势页（天/周/月/年折线图）、我的页展示（可隐藏开关） |
| **数据导入** | GPX/KML/TCX 导入，WGS-84→GCJ-02 坐标转换、类型/来源确认 |
| **轨迹列表** | 左滑删除（二次确认）、类型筛选、**列表/图片双模式**（列表=按月分组 + 月度统计 + 最佳角标 + 骨架屏；图片=2 列网格缩略图）、**最佳角标**（穗枝，前纪录灰显） |
| **个人中心** | 资料编辑（昵称/头像/身高/体重）、数据统计/导入入口、设置、隐私政策 |

## 技术栈

- 微信小程序**原生**开发（不引入 Taro/uni-app）
- UI：**tdesign-miniprogram**（`miniprogram_npm` 按需构建，clone 后 `bash scripts/build-tdesign.sh` 重建，含 icon.wxss 自动裁剪）
- 地图：微信 `map` 组件（GCJ-02）+ echarts（**按需引入**，clone 后 `bash scripts/build-echarts.sh` 重建）
- 分包：点亮地图（echarts + footprint 页）在 `packageFootprint` 分包，主包 ~1.6MB
- 图标：Lucide 图标（PNG，`assets/icons/lucide-*.png`）；tdesign 字体图标由 build-tdesign.sh 自动裁剪（icon.wxss 112KB→~1KB，保留组件库内部用到的 close/chevron-right）
- 后端：`../sport_track_api/`（Fastify 5 + MongoDB，端口 3004，线上 api.historybook.cn）

## 关键设计

- **API 环境切换**：`config/index.js` 按 `envVersion` 自动切（开发=本地 IP / 体验正式=线上），可 FORCE_ONLINE
- **网络层**：JWT 注入 + 401 静默刷新重试；api 挂 `globalData`（分包页面经 `getApp()` 访问）
- **定位权限引导**（`services/location-auth.js`）：`getAppAuthorizeSetting` 判断 → 前台授权 + 后台定位按需触发（iOS「离开后允许」）、拒绝引导去设置、`requiredBackgroundModes`
- **后台定位**：`startLocationUpdateBackground` 优先（切后台继续记录），失败降级前台；无后台权限时切后台自动暂停、回前台手动继续
- **轨迹纠偏**：前端实时（精度/节流/速度/反转/尖刺回滚）+ 后端 finish 存原始点（纠偏权交给用户，手动触发重算），按运动类型调阈值
- **个人最佳口径收口**：`utils/best-records.js` 统一「4 项指标榜 + 距离里程碑保持者链」匹配（详情徽章/列表角标共用）；每次进详情/列表实时拉 `/stats/best` 并回写本地缓存，避免缓存不失效漏判新纪录
- **卡路里**：MET × 体重 × 时长（体重来自资料设置，默认 60kg）
- **头像缓存**：签名 URL 缓存（6h），避免每次进我的页重复下载 CDN
- **隐私合规**：定位权限 desc + requiredPrivateInfos、隐私政策页、启动隐私引导、内容安全检测
- **坐标系**：第三方导入 WGS-84 → GCJ-02（与 eviltransform 一致）

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 重建 tdesign 按需组件 + echarts 按需（clone 后必需）
#    （tdesign 构建完成后自动裁剪未使用的字体图标样式，无需额外步骤）
bash scripts/build-tdesign.sh
bash scripts/build-echarts.sh

# 3. 微信开发者工具 → 导入项目 → 本目录

# 4. 本地设置勾选"不校验合法域名"

# 5. 启动后端（见 ../sport_track_api/README.md）
cd ../sport_track_api && npm run dev
```

> 依赖更新后重跑构建脚本即可；`miniprogram_npm` 不入库（gitignore）。

## 目录结构

```
sport_track_miniapp/
├── project.config.json        # AppID wx68ebe78cca4dc17c + packNpmManually
├── scripts/
│   ├── build-tdesign.sh       # tdesign 按需重建（组件+依赖；结尾自动裁剪 icon.wxss）
│   ├── tree-shake-icons.mjs   # 图标样式裁剪：扫描业务代码 + 组件库内部用法，按需保留（112KB→~1KB）
│   └── build-echarts.sh       # echarts 按需构建（地图模块，996KB→496KB）
├── miniprogram/
│   ├── app.js                 # 静默登录 + 隐私引导 + api 挂 globalData
│   ├── app.json               # 页面/tabBar/分包/权限声明/requiredBackgroundModes
│   ├── config/index.js        # 配置中心（API/运动类型/颜色）
│   ├── services/
│   │   ├── api.js             # 网络层（401 刷新/uploadFile/buildUrl）
│   │   ├── tracker.js         # 运动记录器（采点/过滤/尖刺回滚/指标/seq/恢复）
│   │   ├── sync.js            # 增量上传协议
│   │   ├── location-auth.js   # 定位权限引导（前台+后台）
│   │   ├── oss-upload.js      # OSS 签名直传
│   │   ├── geo.js             # 逆地理编码（后端代理）
│   │   └── storage.js         # 本地缓存
│   ├── utils/format.js        # 时长/公里/配速/compact/formatDurationStat
│   ├── utils/best-records.js  # 个人最佳匹配（4项指标榜 + 距离里程碑保持者链，详情/列表共用）
│   ├── components/
│   │   ├── track-map/         # 地图组件（旋转/POI标注开关/海拔着色/回放）
│   │   ├── track-thumb/       # 轨迹缩略图（canvas 2d 画线）
│   │   ├── calendar-heat/     # 运动日历热力图（GitHub 风格）
│   │   ├── live-stats/        # 实时数据面板
│   │   ├── marker-form/       # 打点表单
│   │   ├── stat-chart/        # 统计图表
│   │   └── share-card/        # 分享海报
│   ├── packageFootprint/      # 分包：点亮地图（echarts + footprint 页）
│   └── pages/
│       ├── index/             # 首页（运动日历/累计数据/类型选择/今日概览）
│       ├── record/            # 运动记录（后台定位/退出暂停/恢复）
│       ├── summary/           # 运动摘要（保存）
│       ├── tracks/            # 轨迹列表（列表/图片双模式 + 最佳角标 + 骨架屏）
│       ├── track-detail/      # 详情（编辑/纠偏/导出/分享海报/最佳记录徽章）
│       ├── stats/             # 数据统计（最佳记录横滑卡片）
│       ├── report/            # 运动报告（周/月/年汇总 + 最佳记录 + 周期海报）
│       ├── overview/          # 轨迹合集（热力/全屏/分享弹窗）
│       ├── import/            # 数据导入
│       ├── weight-trend/      # 体重趋势（天/周/月/年）
│       ├── profile/settings/privacy
│       └── my/                # 我的（资料/身高体重展示/入口）
```

## 里程碑

- [x] M1-M8：骨架/记录/详情/海报/统计/合集/导入/纠偏
- [x] 点亮地图：echarts 真实地图 + 离线省市定位 + 缩放/全屏
- [x] 体重管理：身高体重 + 趋势表 + 展示开关
- [x] 运动日历：GitHub 热力图（365 天）
- [x] 后台定位：接口申请通过 + 前后台持续记录 + 退出恢复
- [x] 个人最佳体系：4 项指标榜 + 距离里程碑 PB（每 5km 步进）+ 保持者链（前纪录终身持有 + 保持天数）+ 穗枝徽章
- [x] 包体积优化：tdesign 按需（5.1MB→1.1MB）、icon.wxss 图标裁剪（112KB→~1KB）、echarts 按需（996KB→496KB）、分包
- [ ] 体验版/正式版发布（合法域名 + 提审）

## 上线待办

1. 微信后台：服务器域名（request `api.historybook.cn`；OSS 域名 uploadFile/downloadFile）
2. 用户隐私保护指引（位置/后台定位/相册/文件）
3. 定位接口权限（wx.getLocation / onLocationChange / startLocationUpdate / startLocationUpdateBackground 已申请通过）
4. 服务类目「工具 > 健康管理 + 信息查询」；上传体验版 → 真机回归 → 提审

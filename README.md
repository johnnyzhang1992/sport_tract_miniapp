# sport_track_miniapp — 运动轨迹记录小程序（前端）

> 版本：v0.1（M1 骨架：tabBar 三页 + 静默登录 + 轨迹列表已联通后端）
> 文档：`docs/`（需求说明书 / 竞品分析 / 前端页面架构 / 后端架构）

## 技术栈

- 微信小程序**原生**开发（决策：不引入 Taro/uni-app）
- UI：**tdesign-miniprogram**（npm 依赖已声明，页面骨架暂用原生组件，后续按需引入）
- 地图：微信 `map` 组件 + 腾讯位置服务 QQMapWX（逆地理编码）
- 后端：`../sport_track_api/`（Fastify，端口 3004）

---

## 🔧 待配置清单（请逐项准备）

> 所有**代码内配置**集中在 `miniprogram/config/index.js`，填好后即可联调。

### 1️⃣ 微信小程序 AppID（✅ 已填：wx68ebe78cca4dc17c）
- 填入：`project.config.json` 的 `appid` 字段（已配置）
- ⚠️ 配套：后端 `.env.local` 需填 `WX_APPID` + `WX_SECRET`（secret 在公众平台获取）才能走真实微信登录；未填前保持 `WX_MOCK_LOGIN=true`

### 2️⃣ 后端 API 地址（必填）
- 填入：`miniprogram/config/index.js` → `API_BASE_URL`
- 开发联调：
  - 微信开发者工具 → 右上角「详情」→「本地设置」→ 勾选 **「不校验合法域名、web-view…」**
  - 模拟器：`http://localhost:3004`（默认已填）
  - **真机预览**：改为电脑局域网 IP（如 `http://192.168.1.5:3004`，需同一 Wi-Fi）
- 生产：必须是 **https 备案域名**，并在小程序后台配置 request 合法域名

### 3️⃣ 腾讯位置服务 Key（逆地理编码/打点地址用）
- 申请：https://lbs.qq.com → 控制台 → 创建应用 → 选「微信小程序」类型并绑定 AppID
- 填入：`miniprogram/config/index.js` → `TENCENT_MAP_KEY`
- 配套依赖 `qqmap-wx-jssdk`（npm），后续 `services/geo.js` 实现时引入

### 4️⃣ 后端环境变量（sport_track_api/.env.local）
| 变量 | 说明 |
|---|---|
| `WX_MOCK_LOGIN` | 开发期无真实 AppID 时设 `true`（任意 code 换测试 openid） |
| `WX_APPID` / `WX_SECRET` | 拿到正式 AppID 后填入，关闭 mock |
| `MONGODB_URI` | 本地 MongoDB 连接串（已配好） |

### 5️⃣ 精确地理位置接口权限（运动记录功能依赖）
- 微信公众平台 → 开发管理 → 接口设置 → 申请 **「wx.getLocation / 精确地理位置」** 类接口权限
- ⚠️ 审核不过的降级方案：海拔/爬升隐藏（见需求文档 D16）

### 6️⃣ 阿里云 OSS（打点照片/头像直传，M2/M3 用）
- 后端 `.env.local`：`OSS_REGION/BUCKET/ENDPOINT/AK_ID/AK_SECRET/ROLE_ARN`
- 前端：`miniprogram/config/index.js` → `OSS.ENDPOINT` 与后端 `OSS_ENDPOINT` 一致
- 生产：小程序后台配置 **uploadFile 合法域名**

### 7️⃣ tdesign-miniprogram npm 构建（✅ 已本地构建，clone 后需重建）
- **本地已构建**：`miniprogram/miniprogram_npm/` 已由 `cp -r node_modules/tdesign-miniprogram/miniprogram_dist miniprogram/miniprogram_npm/tdesign-miniprogram` 生成（该目录被 gitignore，clone 后需重建）
- 或在开发者工具 → 工具 → **「构建 npm」**（标准方式，效果相同）
- 已接入组件：t-button / t-cell / t-cell-group / t-tabs / t-tab-panel / t-dialog / t-avatar / t-tag（页面 json 的 usingComponents 声明）
- 组件 API 以官方文档为准（开发时通过 TDesign MCP server 获取：`npx tdesign-mcp-server`）

---

## 快速开始

```bash
# 1. 安装依赖（npm 构建产物由微信开发者工具生成）
npm install

# 2. 微信开发者工具 → 导入项目 → 选择本目录
#    （project.config.json 已配置 miniprogramRoot=miniprogram/）

# 3. 本地设置勾选"不校验合法域名"

# 4. 启动后端（见 ../sport_track_api/README.md）
cd ../sport_track_api && pnpm dev   # http://localhost:3004

# 5. 工具 → 构建 npm（如需 tdesign 组件）
```

**验证**：打开小程序 → 首页应显示今日概览（0）；「轨迹」tab 应显示空态；登录自动完成（后端日志可见新用户）。

## 目录结构

```
sport_track_miniapp/
├── project.config.json        # ★AppID 占位
├── package.json               # tdesign-miniprogram 依赖
├── miniprogram/
│   ├── app.js / app.json      # 全局：静默登录 + tabBar 三页
│   ├── config/index.js        # ★配置中心（API 地址/地图 Key/运动类型）
│   ├── services/
│   │   ├── api.js             # 网络层：JWT 注入 + 401 静默刷新重试
│   │   └── storage.js         # 本地缓存（token/用户）
│   ├── utils/format.js        # 时长/公里/配速格式化
│   ├── pages/
│   │   ├── index/             # 首页：类型选择 + 今日概览 + 开始入口
│   │   ├── tracks/            # 轨迹列表（分页 + 类型筛选，已联后端）
│   │   ├── my/                # 我的：用户卡片 + 菜单
│   │   ├── track-detail/      # 轨迹详情（指标 + 打点时间线，地图待 track-map）
│   │   └── record/summary/stats/profile/settings   # 占位页
│   └── components/            # track-map/live-stats/marker-form/...（待实现）
```

## 里程碑进度

- [x] 骨架：tabBar 三页、静默登录（wx.login → JWT）、网络层（401 刷新）、轨迹列表联调
- [x] M2 前端：record 实时记录（定位采集/节流/漂移过滤/指标计算/增量上传/打点/暂停结束）→ 摘要页（保存 finish 对账）
- [ ] M3 前端：track-map 完善、轨迹详情地图、回放、打点编辑交互
- [ ] M4：统计图表、轨迹图导出、分享海报、资料编辑、设置
- [ ] M5：真机验证（后台定位/耗电/海拔）、权限引导、提审发布

# 核心业务组件（决策：与 services 层解耦，页面不直接碰网络）

按 docs/03-前端页面架构.md 规划，各组件待对应里程碑实现：

| 组件 | 职责 | 里程碑 |
|---|---|---|
| `track-map` | 地图封装：polyline + marker + 图层切换 + 动态追点 | M2/M3 |
| `live-stats` | 实时数据面板（距离/时长/配速/海拔/爬升/卡路里） | M2 |
| `marker-form` | 打点弹窗（类型 + 备注 + 拍照传 OSS + 地址） | M2/M3 |
| `track-card` | 轨迹列表卡片 | M3（当前列表页已内联实现） |
| `stat-chart` | 图表（柱状统计 + 折线海拔/配速），Canvas 自绘 | M4 |
| `share-card` | 分享海报（Canvas 绘制 + 小程序码） | M4 |

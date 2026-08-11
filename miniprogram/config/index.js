/**
 * ============================================================
 *  全局配置中心 —— 所有需要"填真值"的配置项集中在这里
 *  每一项的取值说明与准备方式见项目根 README.md「待配置清单」
 * ============================================================
 */
module.exports = {
  /**
   * 后端 API 地址（必填）
   *  - 开发：微信开发者工具 → 详情 → 本地设置 → 勾选“不校验合法域名…”
   *    模拟器/真机预览用电脑局域网 IP（需同一 Wi-Fi）；本机 IP 变化时同步更新
   *  - 生产：必须是 https 备案域名，且需在小程序后台配置 request 合法域名
   */
  API_BASE_URL: 'http://192.168.31.138:3004',

  /**
   * 腾讯位置服务 Key（必填，逆地理编码/地址解析用）
   * 申请：https://lbs.qq.com → 控制台 → 创建应用（微信小程序类型，需填 AppID）
   * 配套依赖 qqmap-wx-jssdk（见 docs/03-前端页面架构.md），后续在 services/geo.js 引入
   */
  TENCENT_MAP_KEY: "TENCENT_KEY_REMOVED",

  /**
   * 阿里云 OSS 直传（配合后端 /api/oss/sts 签发凭证；后端见 sport_track_api/.env）
   * 均为后端返回/后端同步配置，前端只需知道直传域名
   */
  OSS: {
    /**
     * 直传域名（与后端 .env OSS_ENDPOINT 一致）
     * 注意：生产需在小程序后台配置 uploadFile 合法域名
     */
    ENDPOINT: "https://your-bucket.oss-cn-hangzhou.aliyuncs.com",
  },

  /**
   * 运动类型配置（决策 D7：配置化，与后端 config/constants.js 保持一致）
   * 前端 icon/文案从这里读，新增类型只需扩展
   */
  ACTIVITY_TYPES: [
    { type: "hiking", label: "徒步", icon: "🏔️", met: 4.3 },
    { type: "walking", label: "散步", icon: "🚶", met: 3.5 },
    { type: "running", label: "跑步", icon: "🏃", met: 9.8 },
    { type: "cycling", label: "骑行", icon: "🚴", met: 7.5 },
    { type: "mountaineering", label: "登山", icon: "⛰️", met: 8.0 },
    { type: "swimming", label: "游泳", icon: "🏊", met: 8.0 },
  ],

  /** 打点类型（决策 F10：可扩展） */
  MARKER_TYPES: [
    { type: "checkpoint", label: "打卡点", icon: "📍" },
    { type: "rest", label: "休息点", icon: "🛋️" },
    { type: "photo", label: "拍照点", icon: "📷" },
    { type: "note", label: "备注", icon: "📝" },
  ],

  /** 同步协议参数（与后端一致） */
  SYNC: {
    /** 增量上传间隔（毫秒） */
    UPLOAD_INTERVAL: 30000,
    /** 单批上传点数上限 */
    BATCH_MAX_POINTS: 2000,
  },
};

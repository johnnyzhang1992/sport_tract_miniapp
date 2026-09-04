/**
 * ============================================================
 *  全局配置中心
 * ============================================================
 */

module.exports = {
  /**
   * 后端 API 地址（按环境自动切换）
   * - 开发版（开发者工具/真机调试）：局域网 IP 联调
   * - 体验版 / 正式版：线上域名
   */
  API_BASE_URL: (() => {
    let envVersion = 'develop';
    try {
      envVersion = wx.getAccountInfoSync().miniProgram.envVersion;
    } catch {
      // 非小程序环境（如 Node 测试）降级为开发版
    }
    // ⚠️ 联调开关：强制走线上域名（体验版调试期保持 true；上线前评估是否保留）
    const FORCE_ONLINE = false;
    const isOnline = FORCE_ONLINE || envVersion === 'release' || envVersion === 'trial';
    // 路径前缀 /sport-track 与同域名其他服务区分（nginx 按前缀转发）
    return isOnline ? 'https://api.historybook.cn/sport-track' : 'http://192.168.31.138:3004/sport-track';
  })(),

  /**
   * 运动类型配置（决策 D7：配置化，与后端 config/constants.js 保持一致）
   * 前端 icon/文案从这里读，新增类型只需扩展
   */
  ACTIVITY_TYPES: [
    { type: 'walking', label: '散步', icon: '🚶', iconImg: '/assets/icons/activity-walking.png', met: 3.5, color: '#FF6B6B' },
    { type: 'running', label: '跑步', icon: '🏃', iconImg: '/assets/icons/activity-running.png', met: 9.8, color: '#2B6CF6' },
    { type: 'hiking', label: '徒步', icon: '🏔️', iconImg: '/assets/icons/activity-hiking.png', met: 4.3, color: '#FF9800' },
    { type: 'mountaineering', label: '爬山', icon: '⛰️', iconImg: '/assets/icons/activity-mountaineering.png', met: 8.0, color: '#8B5CF6' },
    { type: 'cycling', label: '骑行', icon: '🚴', iconImg: '/assets/icons/activity-cycling.png', met: 7.5, color: '#07C160' },
    { type: 'skiing', label: '滑雪', icon: '🎿', iconImg: '/assets/icons/activity-skiing.png', met: 6.0, color: '#29B6F6' },
    { type: 'rowing', label: '划船', icon: '🚣', iconImg: '/assets/icons/activity-rowing.png', met: 7.0, color: '#26A69A' },
    { type: 'swimming', label: '游泳', icon: '🏊', iconImg: '/assets/icons/activity-swimming.png', met: 8.0, color: '#00B8D9' },
  ],

  /** 打点类型（决策 F10：可扩展） */
  MARKER_TYPES: [
    { type: 'checkpoint', label: '打卡点', icon: '📍', iconImg: '/assets/icons/lucide-pin.png' },
    { type: 'rest', label: '休息点', icon: '🛋️', iconImg: '/assets/icons/lucide-coffee.png' },
    { type: 'photo', label: '拍照点', icon: '📷', iconImg: '/assets/icons/lucide-camera.png' },
    { type: 'note', label: '备注', icon: '📝', iconImg: '/assets/icons/lucide-note.png' },
  ],

  /** 打点图标预设盘：用户选图标+文案（category 决定统计归类；文案可在表单里自定义） */
  MARKER_ICON_PRESETS: [
    { icon: '📍', label: '打卡点', category: 'checkpoint' },
    { icon: '☕', label: '休息点', category: 'rest' },
    { icon: '📷', label: '拍照点', category: 'photo' },
    { icon: '📝', label: '备注', category: 'note' },
    { icon: '💧', label: '补水点', category: 'rest' },
    { icon: '🍚', label: '补给点', category: 'rest' },
    { icon: '⛰️', label: '风景点', category: 'photo' },
    { icon: '⚠️', label: '注意', category: 'note' },
  ],

  /** 同步协议参数（与后端一致） */
  SYNC: {
    /** 增量上传间隔（毫秒） */
    UPLOAD_INTERVAL: 30000,
    /** 单批上传点数上限 */
    BATCH_MAX_POINTS: 2000,
  },
};

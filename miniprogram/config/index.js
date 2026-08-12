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
    // ⚠️ 测试开关：强制走线上域名（测完改回 false）
    const FORCE_ONLINE = false;
    const isOnline = FORCE_ONLINE || envVersion === 'release' || envVersion === 'trial';
    return isOnline ? 'https://api.historybook.cn' : 'http://192.168.31.138:3004';
  })(),

  /**
   * 运动类型配置（决策 D7：配置化，与后端 config/constants.js 保持一致）
   * 前端 icon/文案从这里读，新增类型只需扩展
   */
  ACTIVITY_TYPES: [
    { type: 'hiking', label: '徒步', icon: '🏔️', met: 4.3, color: '#FF9800' },
    { type: 'walking', label: '散步', icon: '🚶', met: 3.5, color: '#FF6B6B' },
    { type: 'running', label: '跑步', icon: '🏃', met: 9.8, color: '#2B6CF6' },
    { type: 'cycling', label: '骑行', icon: '🚴', met: 7.5, color: '#07C160' },
    { type: 'mountaineering', label: '登山', icon: '⛰️', met: 8.0, color: '#8B5CF6' },
    { type: 'swimming', label: '游泳', icon: '🏊', met: 8.0, color: '#00B8D9' },
  ],

  /** 打点类型（决策 F10：可扩展） */
  MARKER_TYPES: [
    { type: 'checkpoint', label: '打卡点', icon: '📍' },
    { type: 'rest', label: '休息点', icon: '🛋️' },
    { type: 'photo', label: '拍照点', icon: '📷' },
    { type: 'note', label: '备注', icon: '📝' },
  ],

  /** 同步协议参数（与后端一致） */
  SYNC: {
    /** 增量上传间隔（毫秒） */
    UPLOAD_INTERVAL: 30000,
    /** 单批上传点数上限 */
    BATCH_MAX_POINTS: 2000,
  },
};

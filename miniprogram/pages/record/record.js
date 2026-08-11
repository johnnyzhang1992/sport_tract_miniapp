const config = require('../../config/index');

Page({
  data: {
    type: 'running',
    typeLabel: '跑步',
  },

  onLoad(options) {
    const type = options.type || 'running';
    const meta = config.ACTIVITY_TYPES.find((t) => t.type === type) || {};
    this.setData({ type, typeLabel: meta.label || type });
  },
});

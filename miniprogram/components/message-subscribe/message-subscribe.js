Component({
  properties: {
    visible: { type: Boolean, value: false },
    items: { type: Array, value: [] },
    loading: { type: Boolean, value: false },
    failed: { type: Boolean, value: false },
    busy: { type: String, value: '' },
  },

  methods: {
    noop() {},

    onClose() {
      this.triggerEvent('close');
    },

    onRetry() {
      this.triggerEvent('retry');
    },

    onSubscribeTap(e) {
      const key = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key;
      const templateId = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.template;
      if (!key || !templateId) return;
      this.triggerEvent('subscribe', { key, templateId });
    },
  },
});

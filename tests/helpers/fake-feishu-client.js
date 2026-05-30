function createFakeFeishuClient() {
  const sent = [];

  return {
    sent,
    async sendCard(payload) {
      sent.push(payload);
      return { messageId: `fake_${sent.length}` };
    },
  };
}

module.exports = { createFakeFeishuClient };

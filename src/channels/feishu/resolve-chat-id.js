'use strict';

async function resolveFeishuChatId({ preferredChatId, larkClient }) {
    const configured = String(preferredChatId || '').trim();
    if (configured) return configured;

    if (!larkClient?.im?.chat?.list) return '';

    try {
        const resp = await larkClient.im.chat.list({ params: { page_size: 5 } });
        const chats = resp?.data?.items || [];
        const first = chats.find((item) => String(item?.chat_id || '').trim());
        return first?.chat_id || '';
    } catch {
        return '';
    }
}

module.exports = { resolveFeishuChatId };

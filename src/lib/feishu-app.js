'use strict';

/**
 * 飞书自建应用 client —— hook 进程、flush 子进程、listener 共用的唯一入口。
 * SDK 有 3.5 MB 源码，按需加载：只登记终端目标的 SessionStart 之类事件不该为它付几百毫秒启动费。
 * 需先 require('./env-config') 把 .env 装进 process.env。
 */

let cached = null; // null=未解析；false=无凭据/无群；否则 { client, chatId }

async function getFeishuAppClient() {
    if (cached !== null) return cached;
    const { FEISHU_APP_ID: appId, FEISHU_APP_SECRET: appSecret, FEISHU_CHAT_ID: preferredChatId } = process.env;
    if (!appId || !appSecret) return (cached = false);
    const Lark = require('@larksuiteoapi/node-sdk');
    const { resolveFeishuChatId } = require('../channels/feishu/resolve-chat-id');
    const client = new Lark.Client({ appId, appSecret });
    const chatId = await resolveFeishuChatId({ preferredChatId, larkClient: client });
    return (cached = chatId ? { client, chatId } : false);
}

/** 发交互卡；返回 message_id（发送失败抛错，由调用方决定是否吞） */
async function sendCard(app, card) {
    const r = await app.client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: { receive_id: app.chatId, msg_type: 'interactive', content: JSON.stringify(card) },
    });
    return r?.data?.message_id || null;
}

function patchCard(app, messageId, card) {
    return app.client.im.message.patch({ path: { message_id: messageId }, data: { content: JSON.stringify(card) } });
}

module.exports = { getFeishuAppClient, sendCard, patchCard };

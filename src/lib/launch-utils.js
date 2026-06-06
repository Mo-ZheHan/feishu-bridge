'use strict';

/**
 * 启动器后台进程的公共件（remote-launch / kdbg-launch 共用）：
 * 等 Claude TUI 就绪、发结果卡、登记输入框会话。
 */

const fs = require('fs');
const { spawnSync } = require('child_process');

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** tmux 当前可见内容（失败返 ''） */
const capturePane = session => {
    const r = spawnSync('tmux', ['capture-pane', '-p', '-t', session], { encoding: 'utf8', timeout: 5000 });
    return r.status === 0 ? (r.stdout || '') : '';
};

/**
 * 发卡前等 Claude TUI 就绪：空窗期（mutagen 同步 / exec claude）里注入的首条指令会被吞。
 * 轮询 SessionStart 落盘的 /tmp/claude-tmux-<session>.json；新目录首启的信任弹窗替用户回车确认。超时也放行。
 */
async function waitForSessionReady(session, { bootMs = 120000, settleMs = 1500 } = {}) {
    const file = `/tmp/claude-tmux-${session}.json`;
    const deadline = Date.now() + bootMs;
    let trusted = false;
    while (Date.now() < deadline && !fs.existsSync(file)) {
        if (!trusted && /trust this folder/i.test(capturePane(session))) {
            spawnSync('tmux', ['send-keys', '-t', session, 'Enter']);
            trusted = true;
        }
        await sleep(300);
    }
    await sleep(settleMs);
}

/** 发交互卡（无凭证/无 chatId 时静默跳过） */
async function sendCard(chatId, card) {
    const { FEISHU_APP_ID: appId, FEISHU_APP_SECRET: appSecret } = process.env;
    if (!appId || !appSecret || !chatId) return;
    try {
        const Lark = require('@larksuiteoapi/node-sdk');
        await new Lark.Client({ appId, appSecret }).im.message.create({
            params: { receive_id_type: 'chat_id' },
            data: { receive_id: chatId, msg_type: 'interactive', content: JSON.stringify(card) },
        });
    } catch {}
}

/** 发简单结果卡 */
async function notify({ chatId, title, text, template = 'blue' }) {
    const { card2 } = require('./card');
    await sendCard(chatId, card2({ template, title, elements: [{ tag: 'markdown', content: text }] }));
}

/** 启动成功：发带输入框的卡 + 登记新会话终端，供飞书直接发指令（与 listener.sendLaunchedCard 对称） */
async function announceReady({ chatId, name, title }) {
    if (!chatId) return;
    try {
        const { card2, inputEl, escFooterRow } = require('./card');
        const { SessionState } = require('./session-state');
        const stateKey = `feishu_${name}_${Date.now()}`;
        new SessionState().addNotification(stateKey, {
            session_id: name, notification_type: 'launched', pts_device: `tmux:${name}`, created_at: Date.now(),
            responses: { esc: { keys: '\x1b', label: 'Esc' }, interrupt: { keys: '\x1b', label: '⛔ 中断' } },
        });
        await sendCard(chatId, card2({
            template: 'green', title,
            elements: [
                { tag: 'markdown', content: '在下方直接发指令给它' },
                inputEl(stateKey, '给新会话发指令...'),
                escFooterRow(stateKey, `tmux:${name}`), // 中断 + 右侧终端 id
            ],
        }));
    } catch {}
}

module.exports = { capturePane, waitForSessionReady, notify, announceReady };

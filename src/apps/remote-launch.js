#!/usr/bin/env node
'use strict';

/**
 * launcher.launchRemote 异步 spawn 的后台进程：rsync 拉取远程项目到本地镜像 →
 * tmux detached 启动 claude-remote-shell → 回飞书通知成败。参数全走 RL_* 环境变量。
 */

require('../lib/env-config');
const fs = require('fs');
const { spawnSync } = require('child_process');

const { RL_HOST, RL_PROJ, RL_BASE, RL_DEST, RL_NAME, RL_CHAT_ID, RL_BIN } = process.env;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** tmux 当前可见内容（失败返 ''） */
const capturePane = session => {
    const r = spawnSync('tmux', ['capture-pane', '-p', '-t', session], { encoding: 'utf8', timeout: 5000 });
    return r.status === 0 ? (r.stdout || '') : '';
};

/**
 * 发卡前等 Claude TUI 就绪：空窗期（mutagen 同步 / exec claude）里注入的首条指令会被吞（间歇丢消息根因）。
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

/** 从 ~/.mutagen.yml 派生 rsync exclude，与 zshrc 单一来源一致 */
function mutagenExcludes() {
    const yml = `${process.env.HOME}/.mutagen.yml`;
    if (!fs.existsSync(yml)) return [];
    const r = spawnSync('yq', ['.sync.defaults.ignore.paths[]', yml], { encoding: 'utf8' });
    if (r.status !== 0) return [];
    return (r.stdout || '').split('\n').map(s => s.trim()).filter(Boolean).map(p => `--exclude=${p}`);
}

async function notify(text, template) {
    const { FEISHU_APP_ID: appId, FEISHU_APP_SECRET: appSecret } = process.env;
    if (!appId || !appSecret || !RL_CHAT_ID) return;
    try {
        const Lark = require('@larksuiteoapi/node-sdk');
        const { card2 } = require('../lib/card');
        const card = card2({ template, title: 'claude 远程启动', elements: [{ tag: 'markdown', content: text }] });
        await new Lark.Client({ appId, appSecret }).im.message.create({
            params: { receive_id_type: 'chat_id' },
            data: { receive_id: RL_CHAT_ID, msg_type: 'interactive', content: JSON.stringify(card) },
        });
    } catch {}
}

/** 启动成功：发带输入框的卡 + 登记新会话终端，供飞书直接发指令（与 listener.sendLaunchedCard 对称） */
async function announceReady() {
    const { FEISHU_APP_ID: appId, FEISHU_APP_SECRET: appSecret } = process.env;
    if (!appId || !appSecret || !RL_CHAT_ID) return;
    try {
        const Lark = require('@larksuiteoapi/node-sdk');
        const { card2, inputEl, escFooterRow } = require('../lib/card');
        const { SessionState } = require('../lib/session-state');
        const stateKey = `feishu_${RL_NAME}_${Date.now()}`;
        new SessionState().addNotification(stateKey, {
            session_id: RL_NAME, notification_type: 'launched', pts_device: `tmux:${RL_NAME}`, created_at: Date.now(),
            responses: { esc: { keys: '\x1b', label: 'Esc' }, interrupt: { keys: '\x1b', label: '⛔ 中断' } },
        });
        const card = card2({
            template: 'green', title: `已启动 · ${RL_HOST}:${RL_PROJ}`,
            elements: [
                { tag: 'markdown', content: '在下方直接发指令给它' },
                inputEl(stateKey, '给新会话发指令...'),
                escFooterRow(stateKey, `tmux:${RL_NAME}`), // 中断 + 右侧终端 id
            ],
        });
        await new Lark.Client({ appId, appSecret }).im.message.create({
            params: { receive_id_type: 'chat_id' },
            data: { receive_id: RL_CHAT_ID, msg_type: 'interactive', content: JSON.stringify(card) },
        });
    } catch {}
}

async function main() {
    fs.mkdirSync(RL_DEST, { recursive: true });
    const rsync = spawnSync('/opt/homebrew/bin/rsync',
        ['-az', '--delete', '--delete-excluded', ...mutagenExcludes(), '-e', 'ssh', `${RL_HOST}:${RL_BASE}/${RL_PROJ}/`, `${RL_DEST}/`],
        { encoding: 'utf8', timeout: 600000 });
    if (rsync.status !== 0) {
        await notify(`❌ 拉取 ${RL_HOST}:${RL_PROJ} 失败\n\`\`\`\n${(rsync.stderr || rsync.error?.message || '').slice(-500)}\n\`\`\``, 'red');
        return;
    }
    const tmux = spawnSync('tmux', ['new-session', '-d', '-s', RL_NAME, '-c', RL_DEST,
        `exec claude-remote-shell ${RL_HOST}:${RL_BASE}/${RL_PROJ} ${RL_BIN} --dangerously-skip-permissions`],
        { encoding: 'utf8' });
    if (tmux.status !== 0) {
        await notify(`❌ tmux 启动失败：${(tmux.stderr || '').trim()}`, 'red');
        return;
    }
    await waitForSessionReady(RL_NAME);
    await announceReady();
}

main();

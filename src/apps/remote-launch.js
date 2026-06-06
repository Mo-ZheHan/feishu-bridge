#!/usr/bin/env node
'use strict';

/**
 * launcher.launchRemote 异步 spawn 的后台进程：rsync 拉取远程项目到本地镜像 →
 * tmux detached 启动 claude-remote-shell → 回飞书通知成败。参数全走 RL_* 环境变量。
 */

require('../lib/env-config');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { waitForSessionReady, notify, announceReady } = require('../lib/launch-utils');

const { RL_HOST, RL_PROJ, RL_BASE, RL_DEST, RL_NAME, RL_CHAT_ID, RL_BIN } = process.env;
const fail = text => notify({ chatId: RL_CHAT_ID, title: 'claude 远程启动', template: 'red', text });

/** 从 ~/.mutagen.yml 派生 rsync exclude，与 zshrc 单一来源一致 */
function mutagenExcludes() {
    const yml = `${process.env.HOME}/.mutagen.yml`;
    if (!fs.existsSync(yml)) return [];
    const r = spawnSync('yq', ['.sync.defaults.ignore.paths[]', yml], { encoding: 'utf8' });
    if (r.status !== 0) return [];
    return (r.stdout || '').split('\n').map(s => s.trim()).filter(Boolean).map(p => `--exclude=${p}`);
}

async function main() {
    fs.mkdirSync(RL_DEST, { recursive: true });
    const rsync = spawnSync('/opt/homebrew/bin/rsync',
        ['-az', '--delete', '--delete-excluded', ...mutagenExcludes(), '-e', 'ssh', `${RL_HOST}:${RL_BASE}/${RL_PROJ}/`, `${RL_DEST}/`],
        { encoding: 'utf8', timeout: 600000 });
    if (rsync.status !== 0) {
        await fail(`❌ 拉取 ${RL_HOST}:${RL_PROJ} 失败\n\`\`\`\n${(rsync.stderr || rsync.error?.message || '').slice(-500)}\n\`\`\``);
        return;
    }
    const tmux = spawnSync('tmux', ['new-session', '-d', '-s', RL_NAME, '-c', RL_DEST,
        `exec claude-remote-shell ${RL_HOST}:${RL_BASE}/${RL_PROJ} ${RL_BIN} --dangerously-skip-permissions`],
        { encoding: 'utf8' });
    if (tmux.status !== 0) {
        await fail(`❌ tmux 启动失败：${(tmux.stderr || '').trim()}`);
        return;
    }
    await waitForSessionReady(RL_NAME);
    await announceReady({ chatId: RL_CHAT_ID, name: RL_NAME, title: `已启动 · ${RL_HOST}:${RL_PROJ}` });
}

main();

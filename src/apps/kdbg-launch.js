#!/usr/bin/env node
'use strict';

/**
 * launcher.launchKdbg 异步 spawn 的后台进程：确保 KOALA debug Pod 就绪（无 Pod 自动新建，
 * 复用 ~/.zshrc 的 _kdbg_* 函数）→ tmux detached 启动 claude-remote-shell 指向 Pod →
 * 回飞书通知成败。参数全走 KL_* 环境变量，与 zshrc 的 `claude kdbg` 同构。
 */

require('../lib/env-config');
const { spawnSync } = require('child_process');
const { waitForSessionReady, notify, announceReady } = require('../lib/launch-utils');

const { KL_PROJ, KL_DIR, KL_NAME, KL_CHAT_ID, KL_BIN } = process.env;
const fail = text => notify({ chatId: KL_CHAT_ID, title: 'claude kdbg 启动', template: 'red', text });

async function main() {
    // ① Pod 就绪：无 Pod 自动新建；坏/错隧道自动修
    const ensure = spawnSync('zsh', ['-c', `
        eval "$(grep -E '^export (KOALA_USER|JWT_SECRET_KEY|JWT_SECRET_ID|S3_ACCESS_KEY|S3_SECRET_KEY)=' ~/.zshrc)"
        export PATH="$HOME/.local/bin:/opt/homebrew/bin:$PATH"
        source <(awk '/^# ── kdbg/,/^# Added by CodeBuddy/' ~/.zshrc)
        _kdbg_info >/dev/null 2>&1 || _kdbg_new </dev/null || exit 1
        _kdbg_ensure </dev/null`],
        { encoding: 'utf8', timeout: 20 * 60000 });
    if (ensure.status !== 0) {
        const tail = ((ensure.stdout || '') + '\n' + (ensure.stderr || '')).trim().slice(-400);
        await fail(`❌ debug Pod 就绪失败\n\`\`\`\n${tail}\n\`\`\``);
        return;
    }
    // ② claude 在本地项目目录启动，Bash 经 claude-remote-shell 跑在 Pod
    const tmux = spawnSync('tmux', ['new-session', '-d', '-s', KL_NAME, '-c', KL_DIR,
        `exec /opt/homebrew/bin/claude-remote-shell kdbg:/data/work/mzh/${KL_PROJ} ${KL_BIN} --dangerously-skip-permissions`],
        { encoding: 'utf8' });
    if (tmux.status !== 0) {
        await fail(`❌ tmux 启动失败：${(tmux.stderr || '').trim()}`);
        return;
    }
    await waitForSessionReady(KL_NAME);
    await announceReady({ chatId: KL_CHAT_ID, name: KL_NAME, title: `已启动 · kdbg:${KL_PROJ}` });
}

main();

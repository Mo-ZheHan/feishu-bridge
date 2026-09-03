'use strict';

/**
 * 从飞书起 ccc 会话——复刻 ccc 的 `ccc` / `ccc <host>` 体验，但会话在隔离容器里、detached。
 *   本地：直接跑 host/launch_session.sh --detached（本地无需 mirror seed）
 *   远程：跑 ccc <host> <proj> --detached（ccc 负责 rsync 播种 + mutagen 同步）
 * 起好后是 detached 容器 tmux 会话，由全局 hooks 自动推飞书、纯手机交互；回电脑用 ccc back 接管。
 * 主机表/项目根从 ccc 的 hosts.sh 读，与 ccc 单一来源。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync, spawn, spawnSync } = require('child_process');

const HOME = process.env.HOME;
const ISO_DIR = process.env.WB_ISO_DIR || `${HOME}/Code/chat/tools/claude-isolation`;
const CCC = process.env.WB_CCC || `${HOME}/.local/bin/ccc`;
const LAUNCH = `${ISO_DIR}/host/launch_session.sh`;
const CODE_DIR = process.env.CLAUDE_LAUNCH_DIR || `${HOME}/Code`;
const CLAUDE_HOME = process.env.WB_HOST_CLAUDE_HOME || `${HOME}/.config/claude-isolation/claude`;
const APP_NAME = process.env.WB_APP_NAME || 'workbench-app';
const CONTAINER_RUN = process.env.WB_CONTAINER_RUN || '/wb/run';

// 项目名安全白名单：进 tmux/ssh 命令前过滤，杜绝注入与空格破句
const SAFE_NAME = /^[\w.-]+$/;

/** ccc 的 wb_session_name：claude-[<host>-]<proj>，非字母数字连字符 → -（与容器里一致，用于定位会话） */
function sessionName(proj, host) {
    return `claude-${host ? `${host}-` : ''}${proj}`.replace(/[^A-Za-z0-9-]/g, '-');
}

/** 会话在容器 tmux 里的注入目标（= 精确匹配前缀，见 terminal-inject 的目标语法） */
function sessionTarget(name) {
    return `tmux:=${name}@${APP_NAME}:${CONTAINER_RUN}`;
}

/** 读 ccc 的 hosts.sh（值里有续行/引号，用 bash source 最稳）→ { hosts[], base, overrides{} } */
function readHostsConfig(cfg = `${HOME}/.config/claude-isolation/hosts.sh`) {
    const out = { hosts: [], base: '~/Code', overrides: {} };
    if (!fs.existsSync(cfg)) return out;
    try {
        const dump = execFileSync('bash', ['-c',
            `. ${JSON.stringify(cfg)}; printf '%s\\n' "$WB_REMOTE_HOSTS"; printf '%s\\n' "$WB_REMOTE_BASE"; printf '%s\\n' "$WB_REMOTE_BASE_OVERRIDE"`],
            { encoding: 'utf8', timeout: 5000 });
        const [hosts, base, overrides] = dump.split('\n');
        out.hosts = (hosts || '').split(/\s+/).filter(Boolean);
        if ((base || '').trim()) out.base = base.trim();
        for (const pair of (overrides || '').split(/\s+/).filter(Boolean)) {
            const i = pair.indexOf('=');
            if (i > 0) out.overrides[pair.slice(0, i)] = pair.slice(i + 1);
        }
    } catch {}
    return out;
}

const HOSTS = readHostsConfig();
const REMOTE_HOSTS = HOSTS.hosts;
const remoteBase = host => HOSTS.overrides[host] || HOSTS.base;

/**
 * 解析飞书文本命令（纯函数，可单测）。命令前缀只认 `ccc`（与电脑上的入口同名）。返回其中之一：
 *   { kind: 'ccback' }                                          // `ccc back`：接回正在跑的会话
 *   { kind: 'launch', host: null|string, passArgs: string[] }   // host=null 即本地
 *   { kind: 'unknown_host', host }                              // 首实参不是已知主机也不是 flag
 *   { kind: 'ignore' }                                          // 与本工具无关的普通聊天
 * 首个非 `-` 实参若是已知主机则远程，其余实参（--resume/--continue 等）透传给容器里的 claude。
 */
function parseLaunchCommand(text, remoteHosts = REMOTE_HOSTS) {
    const parts = String(text || '').replace(/@_user_\d+/g, '').trim().split(/\s+/).filter(Boolean);
    if (parts[0] !== 'ccc') return { kind: 'ignore' };
    const rest = parts.slice(1);
    if (rest[0] === 'back') return { kind: 'ccback' }; // `ccc back` 接回，与 ccc 本体的子命令一致
    if (rest.length && !rest[0].startsWith('-')) {
        if (remoteHosts.includes(rest[0])) return { kind: 'launch', host: rest[0], passArgs: rest.slice(1) };
        return { kind: 'unknown_host', host: rest[0] };
    }
    return { kind: 'launch', host: null, passArgs: rest };
}

/** ~/Code 一级子目录（排除隐藏与含特殊字符的） */
function listLocalProjects() {
    try {
        return fs.readdirSync(CODE_DIR, { withFileTypes: true })
            .filter(d => d.isDirectory() && !d.name.startsWith('.') && SAFE_NAME.test(d.name))
            .map(d => d.name).sort();
    } catch { return []; }
}

/** ssh 列远程 host 的 base 下一级目录。返回 { projects } 或 { error } */
function listRemoteProjects(host) {
    if (!REMOTE_HOSTS.includes(host)) return { error: `未知主机: ${host}` };
    const r = spawnSync('ssh', [host, `cd ${remoteBase(host)} 2>/dev/null && ls -1d */ 2>/dev/null`],
        { encoding: 'utf8', timeout: 20000 });
    if (r.status !== 0) return { error: (r.stderr || r.error?.message || 'ssh 失败').trim() };
    const projects = (r.stdout || '').split('\n')
        .map(s => s.replace(/\/$/, '').trim()).filter(s => SAFE_NAME.test(s));
    return { projects };
}

/** 项目在容器里的 cwd → Claude 的 slug（cwd 的每个非字母数字字符换成 -，下划线也算）。
 *  本地 = Mac 路径 `~/Code/<proj>`；远程 = `/home/<host>/<proj>`（与容器里一致，见 launch_session.sh） */
function projectSlug(proj, host) {
    const cwd = host ? `/home/${host}/${proj}` : path.join(CODE_DIR, proj);
    return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

/** 读 transcript 头部取首条 user 文本作会话标签（文件可达数百 MB，只读头 64KB）；有 summary 优先 */
function sessionSummary(file) {
    let fd;
    try { fd = fs.openSync(file, 'r'); } catch { return ''; }
    try {
        const buf = Buffer.alloc(65536);
        const n = fs.readSync(fd, buf, 0, 65536, 0);
        for (const line of buf.subarray(0, n).toString('utf8').split('\n')) {
            let d; try { d = JSON.parse(line); } catch { continue; }
            if (d.type === 'summary' && d.summary) return String(d.summary).replace(/\s+/g, ' ').trim();
            const c = d?.message?.content;
            if (d.type === 'user' && typeof c === 'string' && c.trim()) return c.replace(/\s+/g, ' ').trim();
        }
        return '';
    } catch { return ''; } finally { fs.closeSync(fd); }
}

/** 列某项目可恢复的会话（读 Claude 的 projects/<slug> 目录），按最近活动倒序。返回 [{ id, mtime, summary }] */
function listResumableSessions(proj, host, limit = 12) {
    const dir = path.join(CLAUDE_HOME, 'projects', projectSlug(proj, host));
    let files;
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')); } catch { return []; }
    return files.map(f => {
        const full = path.join(dir, f);
        let mtime = 0;
        try { mtime = fs.statSync(full).mtimeMs; } catch {}
        return { id: f.slice(0, -6), mtime, summary: sessionSummary(full) };
    }).sort((a, b) => b.mtime - a.mtime).slice(0, limit);
}

/** detached 本地启动：直接跑 launch_session.sh --detached。返回 { name, target } 或 { error } */
function launchLocal(proj, extraArgs = []) {
    if (!SAFE_NAME.test(proj)) return { error: `非法项目名: ${proj}` };
    const dir = path.join(CODE_DIR, proj);
    if (!fs.existsSync(dir)) return { error: `目录不存在: ${dir}` };
    spawnDetached('bash', [LAUNCH, '--detached', dir, '--', '--dangerously-skip-permissions', ...extraArgs]);
    const name = sessionName(proj);
    return { name, target: sessionTarget(name) };
}

/** detached 远程启动：ccc <host> <proj> --detached（rsync 播种耗时，交给 detached 子进程）。返回 { name, target } 或 { error } */
function launchRemote(host, proj, extraArgs = []) {
    if (!REMOTE_HOSTS.includes(host) || !SAFE_NAME.test(proj)) return { error: `非法主机或项目: ${host} ${proj}` };
    spawnDetached('bash', [CCC, host, proj, '--detached', '--', ...extraArgs]);
    const name = sessionName(proj, host);
    return { name, target: sessionTarget(name) };
}

function spawnDetached(cmd, args) {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', env: process.env });
    child.unref();
}

module.exports = {
    REMOTE_HOSTS, CODE_DIR,
    sessionName, sessionTarget, readHostsConfig, parseLaunchCommand,
    listLocalProjects, listRemoteProjects, launchLocal, launchRemote, remoteBase,
    projectSlug, listResumableSessions,
};

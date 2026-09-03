'use strict';

/**
 * 会话统计公共件：statusLine 旁路落盘的官方字段（成本 / 上下文 / 5h 与 7d 限额）→ 卡片 header 标签。
 * claude-hook（Stop / 权限卡）与 completion-card（ccc back 卡）共用。
 *
 * 文件按完整 session_id 命名（claude-cost-<sid>.json），多窗口互不干扰。目录：宿主 Claude 走 /tmp
 * （setup/claude-settings.json 的 cost-capture 管线）；容器会话由 claude-isolation 的 statusline 写进
 * 该会话的 TMPDIR，bridge 用 CLAUDE_STATS_DIR 把它告诉 hook。
 */

const fs = require('fs');
const path = require('path');

/** 分钟数 → 紧凑倒计时：2d 5h / 3h 1m / 45m（与状态栏同一写法，看惯了不用换脑子） */
function fmtLeft(minutes) {
    const m = Math.max(0, Math.round(minutes));
    if (m >= 1440) return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
    if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
    return `${m}m`;
}

/**
 * 一个限额窗口 { resetsAt: 秒或毫秒, pct: 已用% } → { text, pct }。
 * 文案沿用状态栏的「到重置的时间 (已用%)」；过了重置点则已用量已失效，只报「已重置」。
 */
function describeQuota(win, now = Date.now()) {
    if (!win || typeof win.resetsAt !== 'number') return null;
    const resetMs = win.resetsAt > 1e12 ? win.resetsAt : win.resetsAt * 1000;
    if (resetMs <= now) return { text: '已重置', pct: 0 };
    const pct = typeof win.pct === 'number' ? Math.round(win.pct) : null;
    const left = fmtLeft((resetMs - now) / 60000);
    return { text: pct == null ? left : `${left} (${pct}%)`, pct };
}

/** 已用比例 → 标签色（飞书 2.0 text_tag 色名）：一眼看出紧不紧 */
function quotaColor(pct) {
    if (pct == null) return 'neutral';
    return pct >= 80 ? 'red' : pct >= 50 ? 'orange' : 'neutral';
}

/** 兼容两种落盘写法：容器 statusline 的 {resetsAt,pct} 与官方原字段名 {resets_at,used_percentage} */
function quotaWindow(w) {
    if (!w || typeof w !== 'object') return null;
    const resetsAt = w.resetsAt ?? w.resets_at;
    const pct = w.pct ?? w.used_percentage;
    return typeof resetsAt === 'number' ? { resetsAt, pct: typeof pct === 'number' ? pct : null } : null;
}

/** 读官方统计；无文件 / 坏文件返 null */
function readOfficialStats(sessionId, statsDir = process.env.CLAUDE_STATS_DIR || '/tmp') {
    if (!sessionId) return null;
    try {
        const j = JSON.parse(fs.readFileSync(path.join(statsDir, `claude-cost-${sessionId}.json`), 'utf8'));
        return {
            costUSD: typeof j.cost === 'number' ? j.cost : null,
            contextPct: typeof j.contextPct === 'number' ? j.contextPct : null,
            sessionName: j.sessionName,
            fiveHour: quotaWindow(j.fiveHour),
            sevenDay: quotaWindow(j.sevenDay),
        };
    } catch { return null; }
}

module.exports = { fmtLeft, describeQuota, quotaColor, readOfficialStats };

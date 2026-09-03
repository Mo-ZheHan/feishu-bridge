#!/usr/bin/env node
'use strict';

/**
 * statusLine 收尾：把 ccusage 那个「本地重算」的 5h 倒计时换成 Claude Code 官方真实重置时间，
 * 并补上官方 seven_day 总周限额。
 *
 * ccusage 的 (Xh Ym left) = floor(本窗口首条消息→整点) + 5h - now，取整就会偏（实测 ~50min）。
 * 而 statusLine 的 JSON 本就带官方 rate_limits.five_hour.resets_at（+已用%），由 cost-capture.js
 * 按 ppid 落到 /tmp/claude-sl-<ppid>.json（同管道两 node 共享父 shell，故 ppid 相同）。
 *
 *   用法：node cost-capture.js | ccusage statusline | node statusline-fix.js
 *   降级：官方数据缺失（子会话等）时原样保留 ccusage 段，绝不让状态栏变空。
 */

const fs = require('fs');

function tsMs(ts) {
    return ts > 1e12 ? ts : ts * 1000;
}

function leftMinutes(resetsAt) {
    return Math.max(0, Math.round((tsMs(resetsAt) - Date.now()) / 60000));
}

function formatShort(minutes) {
    if (minutes >= 1440) {
        const days = Math.floor(minutes / 1440);
        const hours = Math.floor((minutes % 1440) / 60);
        return `${days}d ${hours}h`;
    }
    if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    return `${minutes}m`;
}

function pctText(pct) {
    return pct != null ? ` (${Math.round(pct)}%)` : '';
}

let data = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => (data += c));
process.stdin.on('end', () => {
    // 1. 去掉 ccusage 的 "🤖 <model> | " 前缀
    let line = data.replace(/^🤖 [^|]*\| /, '');
    line = line
        .replace(/ \| 🔥 [^|\n]*(?=\|)/g, ' ')
        .replace(/ \| 🔥 [^|\n]*(?=\n?$)/g, '');

    // 2. 读官方限额重置，拼成展示段
    let seg = null;
    try {
        const f = `/tmp/claude-sl-${process.ppid}.json`;
        const m = JSON.parse(fs.readFileSync(f, 'utf8'));
        fs.unlinkSync(f); // 读完即删，避免 /tmp 堆积
        const fiveHour = m.fiveHour ?? (m.resetsAt != null ? { resetsAt: m.resetsAt, pct: m.pct } : null);
        if (fiveHour?.resetsAt != null) {
            const parts = [`⏳ ${formatShort(leftMinutes(fiveHour.resetsAt))}${pctText(fiveHour.pct)}`];
            if (m.sevenDay?.resetsAt != null || m.sevenDay?.pct != null) {
                const weekTime = m.sevenDay.resetsAt != null
                    ? formatShort(leftMinutes(m.sevenDay.resetsAt))
                    : '';
                parts.push(`${weekTime}${pctText(m.sevenDay.pct)}`.trim());
            }
            seg = parts.filter(Boolean).join(' ');
        }
    } catch {}

    // 3. 有官方数据才动刀：去掉 block 段，把官方限额段插到上下文段之前；否则原样保留
    if (seg) {
        line = line.replace(/ \/ \$[\d.]+ block \([^)]*\)/, '');
        line = / \| 🧠/.test(line)
            ? line.replace(/ \| 🧠/, ` | ${seg} | 🧠`)
            : line.replace(/\n?$/, ` | ${seg}\n`);
    }

    process.stdout.write(line);
});

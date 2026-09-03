#!/usr/bin/env node
'use strict';

/**
 * statusLine 旁路：把 stdin 原样透传给下游（ccusage），同时把 Claude Code 官方的
 * 成本/上下文/限额等字段落盘到 /tmp/claude-cost-<session_id>.json，供 Stop hook 读取。
 *
 * hook 的输入不含 cost，只有 statusLine 的输入有 cost.total_cost_usd（客户端实时计算）。
 * 把它接在 statusLine 命令最前面即可，例：
 *   node .../cost-capture.js | ccusage statusline | sed '...'
 *
 * 并发：每个会话 session_id 唯一 → 各写各的文件，多窗口互不干扰；
 * temp+rename 原子替换，避免 hook 读到正在写的半截 JSON。
 */

const fs = require('fs');

function pctOf(limit) {
    for (const key of ['used_percentage', 'percent', 'utilization']) {
        const v = limit?.[key];
        if (typeof v === 'number' && Number.isFinite(v)) {
            return v > 0 && v <= 1 ? v * 100 : v;
        }
    }
    return null;
}

function resetOf(limit) {
    const v = limit?.resets_at ?? limit?.resetsAt;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

let data = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => (data += c));
process.stdin.on('end', () => {
    process.stdout.write(data); // 先无条件透传，落盘失败也绝不影响状态栏
    try {
        const j = JSON.parse(data);
        if (j.session_id && j.cost) {
            const file = `/tmp/claude-cost-${j.session_id}.json`;
            const tmp = `${file}.${process.pid}`;
            const quota = w => (w ? { resetsAt: resetOf(w), pct: pctOf(w) } : null);
            fs.writeFileSync(tmp, JSON.stringify({
                cost: j.cost.total_cost_usd,
                contextPct: j.context_window?.used_percentage,
                sessionName: j.session_name,
                fiveHour: quota(j.rate_limits?.five_hour), // 完成卡的 ⏳ / 📅 限额标签从这读
                sevenDay: quota(j.rate_limits?.seven_day),
                ts: Date.now(),
            }));
            fs.renameSync(tmp, file);
        }
        // 官方限额重置 → 给收尾脚本 statusline-fix.js（同管道两 node 共享父 shell，ppid 相同可关联、不串台）
        const limits = j.rate_limits ?? {};
        const fiveHour = limits.five_hour;
        const fiveHourReset = resetOf(fiveHour);
        if (fiveHourReset !== null) {
            const sevenDay = limits.seven_day;
            fs.writeFileSync(`/tmp/claude-sl-${process.ppid}.json`,
                JSON.stringify({
                    fiveHour: { resetsAt: fiveHourReset, pct: pctOf(fiveHour) },
                    sevenDay: resetOf(sevenDay) !== null || pctOf(sevenDay) !== null
                        ? { resetsAt: resetOf(sevenDay), pct: pctOf(sevenDay) }
                        : null,
                }));
        }
    } catch {}
});

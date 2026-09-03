'use strict';

/**
 * 真机验证「Claude 完成」卡的 header 标签样式（成本 / 上下文 / 5h / 📅 7d 限额），发一张样例卡到群。
 * 用法：node scripts/send-stop-test-card.js
 */

require('../src/lib/env-config');
const { getFeishuAppClient, sendCard } = require('../src/lib/feishu-app');
const { card2, statsTags, statsSubtitle, inputEl, escFooterRow } = require('../src/lib/card');
const { parseMarkdownToElements } = require('../src/lib/feishu-card-utils');

(async () => {
    const app = await getFeishuAppClient();
    if (!app) { console.error('缺飞书凭据或群 id'); process.exit(1); }
    const now = Date.now() / 1000;
    const stats = {
        costUSD: 1.23, contextPct: 42.4, sessionName: '样例会话',
        fiveHour: { resetsAt: now + 3 * 3600 + 60, pct: 75 },
        sevenDay: { resetsAt: now + 14 * 3600 + 31 * 60, pct: 44 },
    };
    const card = card2({
        template: 'green', title: 'Claude 完成', subtitle: statsSubtitle(stats), tags: statsTags(stats),
        elements: parseMarkdownToElements('（样例卡）副标题是会话名 · 成本；header 三个标签依次是上下文占用、⏳ 5h 限额、📅 7d 限额（飞书最多显示 3 个）。\n限额写成「到重置的时间 (已用%)」，与状态栏同款；已用过半变橙，过八成变红。'),
    });
    card.body.elements.push(inputEl('test-stop-card'), escFooterRow('test-stop-card', 'tmux:=claude-chat@workbench-app:/wb/run'));
    console.log('sent', await sendCard(app, card));
})().catch(err => { console.error(err.message); process.exit(1); });

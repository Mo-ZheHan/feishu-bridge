'use strict';

/**
 * Claude Code PreToolUse hook handler for AskUserQuestion
 *
 * 通过 stdin 收到 AskUserQuestion，发一张飞书 form 卡让用户手机作答。
 * 单题/多题、单选/多选统一走 buildQuestionsForm；listener 收 form_value 后回放注入 TUI。
 */

require('../lib/env-config');
const { sessionState } = require('../lib/session-state');
const { resolvePtsDevice } = require('../lib/terminal-inject');
const { buildQuestionsForm, buildSingleSelectCard } = require('../lib/feishu-card-utils');
const { findTail } = require('../lib/transcript-utils');
const { getFeishuAppClient, sendCard: sendFeishuCard } = require('../lib/feishu-app');
const { readStdinJson } = require('../lib/stdin-json');

/** 最后一条 assistant 消息里、AskUserQuestion 之前的文本块（作卡片上下文）；最后一条不含问卷则 '' */
function extractContextText(transcriptPath) {
    return findTail(transcriptPath, (d) => {
        if (d.type !== 'assistant') return undefined;
        const content = d.message?.content || [];
        if (!content.some(b => b.type === 'tool_use' && b.name === 'AskUserQuestion')) return '';
        return content.filter(b => b.type === 'text' && b.text).map(b => b.text).join('\n').trim();
    }) || '';
}

// ── Card senders ──────────────────────────────────────────

// 预览题：任一选项带 preview 字段（样例图 → TUI 走左右并排布局，无自定义行，靠 'n' 加备注）
const hasPreview = q => q.options.some(o => o && o.preview != null);

// 回放元数据：单/多选 + 选项数 + hasPreview（算键序用）+ header/选项 label（回显卡用）；中断键所有卡通用
const replayMeta = q => ({ multiSelect: !!q.multiSelect, optionCount: q.options.length, hasPreview: hasPreview(q), header: q.header || q.question || '', options: q.options.map(o => o.label) });

/** 发卡 + 登记回放 state；meta 区分卡型（_single_select / _questions_form）*/
async function sendCard(app, card, stateKey, ptsDevice, sessionId, notificationType, meta) {
    sessionState.addNotification(stateKey, {
        session_id: sessionId, notification_type: notificationType, pts_device: ptsDevice, created_at: Date.now(),
        responses: { esc: { keys: '\x1b', label: 'Esc' }, interrupt: { keys: '\x1b', label: '⛔ 中断' } },
        ...meta,
    });
    try {
        await sendFeishuCard(app, card);
    } catch (err) {
        console.error('[ask-handler] 发送卡片失败:', err.message);
    }
}

/** 单题单选 → 按钮卡（点一下即答）；回放共用 buildReplayPlan：listener 按 opt_i / 自定义输入调 replayQuestions */
function sendSingleSelectCard(app, q, stateKey, ptsDevice, sessionId, notificationType) {
    return sendCard(app, buildSingleSelectCard(q, stateKey, ptsDevice), stateKey, ptsDevice, sessionId, notificationType,
        { _single_select: true, _questions: [replayMeta(q)] });
}

/** 多题 / 单题多选 → 单 form 卡：一次收齐答案，listener 收 form_value 后回放注入 TUI */
function sendQuestionsForm(app, questions, stateKey, ptsDevice, sessionId, notificationType) {
    return sendCard(app, buildQuestionsForm(questions, stateKey, ptsDevice), stateKey, ptsDevice, sessionId, notificationType,
        { _questions_form: true, _questions: questions.map(replayMeta) });
}

// ── Main ─────────────────────────────────────────────────

async function main() {
    const data = await readStdinJson();

    // Guard: only handle PreToolUse / AskUserQuestion
    if (data.hook_event_name !== 'PreToolUse') return;
    if (data.tool_name !== 'AskUserQuestion') return;

    const questions = data.tool_input?.questions;
    if (!Array.isArray(questions) || questions.length === 0) return;

    const app = await getFeishuAppClient();
    if (!app) return;

    const sessionId = data.session_id || '';
    const stateKey = `feishu_ask_${sessionId.substring(0, 8)}_${Date.now()}`;
    const ptsDevice = resolvePtsDevice(process.ppid);
    const notificationType = 'AskUserQuestion';

    // Attach contextText (text blocks before the AskUserQuestion tool_use) for the card builders
    const contextText = extractContextText(data.transcript_path);
    questions.forEach(q => { q._contextText = contextText; });

    // 单题单选(非预览) → 按钮卡（一点即答）；多题/多选/预览题 → form 卡（预览题要选项+备注一起收）。回放都走 buildReplayPlan
    if (questions.length === 1 && !questions[0].multiSelect && !hasPreview(questions[0])) {
        await sendSingleSelectCard(app, questions[0], stateKey, ptsDevice, sessionId, notificationType);
    } else {
        await sendQuestionsForm(app, questions, stateKey, ptsDevice, sessionId, notificationType);
    }
}

if (require.main === module) {
    main().catch(err => { console.error('[ask-handler]', err.message); process.exit(0); });
}

module.exports = {
    getFeishuAppClient,
    sendSingleSelectCard,
    sendQuestionsForm,
    extractContextText,
    main,
};

/**
 * Claude Code Hook 统一处理器
 * 读取 hook stdin JSON，根据事件类型发送不同格式的飞书卡片通知
 *
 * 支持的事件:
 *   Stop         - 任务完成，携带最后一条助手消息
 *   Notification - 等待用户操作（权限确认、方案选择等）
 *   StopFailure  - 异常退出（API 错误等）
 *   SessionStart - 不发卡，只登记「tmux 会话 → transcript / 终端目标」供 ccc back 用
 */

const fs = require('fs');
const { feishuEnabled } = require('../lib/env-config');
const { sessionState } = require('../lib/session-state');
const { resolvePtsDevice, tmuxSessionName } = require('../lib/terminal-inject');
const { parseMarkdownToElements } = require('../lib/feishu-card-utils');
const { card2, statsTags, statsSubtitle, inputEl, buttonRow, footer, escFooterRow } = require('../lib/card');
const { forEachTail, findTail, getAssistantText } = require('../lib/transcript-utils');
const { readOfficialStats } = require('../lib/session-stats');
const { getFeishuAppClient, sendCard: sendFeishuCard } = require('../lib/feishu-app');
const { readStdinJson } = require('../lib/stdin-json');
const { KEY_TOOLS } = require('../lib/key-tools');

// ── 工具函数 ─────────────────────────────────────────────

/** 最后一条 assistant 消息里的 AskUserQuestion 输入及其前置文本；最后一条不含则 null */
function extractAskUserQuestion(transcriptPath) {
    return findTail(transcriptPath, (d) => {
        if (d.type !== 'assistant') return undefined;
        let askInput = null;
        let contextText = '';
        for (const block of d.message?.content || []) {
            if (block.type === 'text' && block.text) contextText += block.text + '\n';
            if (block.type === 'tool_use' && block.name === 'AskUserQuestion') askInput = block.input;
        }
        if (!askInput) return null; // 最后一条 assistant 消息不是问卷：到此为止，别往更早的问卷翻
        askInput._contextText = contextText.trim();
        return askInput;
    }) || null;
}

/** session 是否 bypass：先看 payload，否则 transcript 反扫 permissionMode */
function isBypassMode(data) {
    if (data.permission_mode === 'bypassPermissions') return true;
    return findTail(data.transcript_path, (d) =>
        d.permissionMode !== undefined ? d.permissionMode === 'bypassPermissions' : undefined
    ) === true;
}

/** 登记 tmux 会话 → 当前 transcript / 终端目标 / 统计目录，供 ccc back 按会话精确定位（同目录多会话也不混） */
function registerTmuxSession(target, data) {
    if (!target?.startsWith('tmux:') || !data.transcript_path) return;
    try {
        fs.writeFileSync(`/tmp/claude-tmux-${tmuxSessionName(target.slice(5))}.json`, JSON.stringify({
            transcript: data.transcript_path,
            target,
            statsDir: process.env.CLAUDE_STATS_DIR || null,
            session_id: data.session_id || null,
        }));
    } catch {}
}

// ── 卡片构建 ─────────────────────────────────────────────

/** Stop / StopFailure 卡：会话名·成本作副标题，上下文/限额作 header 标签，正文为 body；输入框与 footer 由发送侧补 */
function buildCard(title, body, template, stats) {
    return card2({ template, title, subtitle: statsSubtitle(stats), tags: statsTags(stats), elements: parseMarkdownToElements(body) });
}

// ── 事件处理 ─────────────────────────────────────────────

// 飞书单卡硬限实测 ~150KB（API code 230025），30000 字（中文最坏 ~90KB）仍稳；仅兜底极端单轮。
const STOP_BODY_MAX = 30000;

function handleStop(data, getStats) {
    // 只收「最近一次关键工具之后」的 text：之前的 narration 已由蓝色 live 卡显示，避免重复。
    // 边界须与 live 卡同认 KEY_TOOLS——非关键工具(Read/Grep)不算边界，否则夹在它前面的话两头落空被吞。
    // （无工具的纯文本 turn 收到 user prompt 边界 = 全部）。last_assistant_message 补未 flush 的尾段
    const texts = [];
    let boundaryTs = 0; // 停下来的边界 ts（最近一次关键工具，或无工具时的 user prompt），作去重 epoch
    forEachTail(data.transcript_path, (d) => {
        const ts = +new Date(d.timestamp || 0);
        if (d.type === 'user' && typeof d.message?.content === 'string') { boundaryTs = ts; return true; }
        if (d.type !== 'assistant') return false;
        if ((d.message?.content || []).some(b => b.type === 'tool_use' && KEY_TOOLS.has(b.name))) { boundaryTs = ts; return true; }
        const text = getAssistantText(d);
        if (text) texts.unshift(text);
        return false;
    });
    const last = (data.last_assistant_message || '').trim();
    if (last && texts[texts.length - 1] !== last) texts.push(last);
    const body = texts.join('\n\n');

    // 一个 prompt 内多次 Stop，只发新增前缀差；边界 ts 变了（跑了新工具/新 turn）→ 重置 prev 整段发
    const sentKey = `__stop_sent_${(data.session_id || '').slice(0, 8)}`;
    sessionState.load();
    const slot = sessionState.data[sentKey];
    const prev = slot && slot.boundaryTs === boundaryTs ? slot.body : '';
    const delta = body.startsWith(prev) ? body.slice(prev.length).trim() : body;

    const save = () => { sessionState.data[sentKey] = { body, boundaryTs, created_at: Date.now() }; sessionState.save(); };
    if (!delta) {
        if (slot) return null; // 无新增且已发过 → 跳过
        save();
        return buildCard('Claude 完成', '任务已完成，可以查看执行结果了', 'green', getStats());
    }
    save();
    const shown = delta.length > STOP_BODY_MAX ? '…（仅显示最新部分）\n\n' + delta.slice(-STOP_BODY_MAX) : delta;
    return buildCard('Claude 完成', shown, 'green', getStats());
}

// 官方错误码 → { 标题, 兜底正文 }。标题与兜底同源，二者不会漂移；正文按下面 handleStopFailure 的
// 顺序取，兜底是最后一档，保证卡片正文永远贴合当前这次失败、不会翻出历史消息。未知码退回通用条目。
const ERROR_INFO = {
    rate_limit:            { title: 'API 频率限制', hint: '已触发使用限额，需等待窗口重置。' },
    authentication_failed: { title: '认证失败',     hint: '认证失败：凭据无效或已过期。' },
    billing_error:         { title: '计费错误',     hint: '账户计费异常。' },
    server_error:          { title: '服务器错误',   hint: 'API 服务器错误（如 529 Overloaded），通常是暂时的，稍后重试即可。' },
    max_output_tokens:     { title: '输出超长',     hint: '单次输出超过上限。' },
    invalid_request:       { title: '请求无效',     hint: '请求被拒绝。' },
};
const UNKNOWN_ERROR = { title: '异常退出', hint: '发生未知错误。' };

// StopFailure 在错误后立即触发，真正的原因就在 transcript 末尾的几秒之内。更早的 isApiErrorMessage 是
// 历史遗留（如今早触发过限额、早已重置），贴到当前这次失败上只会张冠李戴。反扫时最近一条一旦超过这个
// 窗口，就当作 transcript 里没有当前错误，让正文回退到按错误码的兜底文案。
const RECENT_ERROR_MS = 2 * 60 * 1000;

/** transcript 末尾最近一条 API 错误的原文，且必须新鲜（RECENT_ERROR_MS 内）；否则 undefined。
 *  反扫最先遇到的即最近一条：新鲜则用，过期则以 null 终止扫描（更早的只会更旧、无需再看）。 */
function recentApiError(transcriptPath, now = Date.now()) {
    return findTail(transcriptPath, (d) => {
        if (d.type !== 'assistant' || !d.isApiErrorMessage) return undefined;
        const fresh = d.timestamp && now - new Date(d.timestamp).getTime() <= RECENT_ERROR_MS;
        return fresh ? (getAssistantText(d) || undefined) : null;
    }) || undefined;
}

/** StopFailure：标题按错误码；正文取 error_details → 新鲜的 transcript 错误 → 按错误码的兜底，三者同源不串台 */
function handleStopFailure(data, getStats) {
    const info = ERROR_INFO[data.error] || UNKNOWN_ERROR;
    const details = data.error_details || recentApiError(data.transcript_path) || info.hint;
    return buildCard(info.title, details, 'red', getStats());
}

// ── 发送 ─────────────────────────────────────────────────

/** 发卡 + 注册回调路由：发送成功才记 sessionState；esc/interrupt 通用中断键在此统一注入 */
async function sendCard(app, card, { stateKey, sessionId, type, ptsDevice, responses = {} }) {
    try {
        await sendFeishuCard(app, card);
        sessionState.addNotification(stateKey, {
            session_id: sessionId,
            notification_type: type,
            pts_device: ptsDevice,
            created_at: Date.now(),
            responses: {
                ...responses,
                esc: { keys: '\x1b', label: 'Esc' },
                interrupt: { keys: '\x1b', label: '⛔ Interrupt' },
            },
        });
    } catch (err) {
        console.error('[feishu] 发送卡片失败:', err.message);
    }
}

/** 普通卡片（Stop / StopFailure） */
async function sendFeishuAppCard(data, event, getStats, ptsDevice) {
    const handler = { Stop: handleStop, StopFailure: handleStopFailure }[event];
    if (!handler) return;

    const card = handler(data, getStats);
    if (!card) return; // handler 返 null 即跳过（Stop 增量空时）

    const app = await getFeishuAppClient();
    if (!app) return;

    // 末尾补输入框（卡片直接回话）+ 中断按钮与终端 id 同行
    const sessionId = data.session_id || '';
    const stateKey = `feishu_${sessionId.substring(0, 8)}_${Date.now()}`;
    card.body.elements.push(inputEl(stateKey), escFooterRow(stateKey, ptsDevice));

    await sendCard(app, card, { stateKey, sessionId, type: event, ptsDevice });
}

// ── 权限卡片构建 ─────────────────────────────────────────

/** 反扫 transcript 取最近一次 tool_use 的 markdown 描述 */
function describeLatestTool(transcriptPath, fallback) {
    return findTail(transcriptPath, (d) => {
        if (d.type !== 'assistant') return undefined;
        const tool = (d.message?.content || []).find(b => b.type === 'tool_use');
        if (!tool) return undefined;
        const input = tool.input || {};
        if (tool.name === 'Bash' && input.command) {
            return `⌘ **Bash**\n\`\`\`\n${input.command}\n\`\`\`` + (input.description ? `\n${input.description}` : '');
        }
        if (input.file_path) {
            return `${({ Read: '📖', Edit: '📝', Write: '📝' })[tool.name] || '🔧'} **${tool.name}**: \`${input.file_path}\``;
        }
        return `🔧 **${tool.name}**`;
    }) ?? fallback;
}

/** 从 pty-relay 的输出文件解析终端实际的 Yes/No 编号选项（仅 pty-relay 路径有此文件） */
function parsePermissionOptions(ptsDevice) {
    const m = ptsDevice?.match(/pts(\d+)/);
    if (!m) return [];
    let raw;
    try { raw = fs.readFileSync(`/tmp/claude-pty-output-${m[1]}`, 'utf8'); } catch { return []; }
    // eslint-disable-next-line no-control-regex
    const clean = raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    const opts = [];
    const re = /(\d+)\.\s*(.+)/g;
    let mm;
    while ((mm = re.exec(clean)) !== null) {
        const text = mm[2].trim().split(/\r|\n/)[0].trim();
        if (/^(Yes|No)/i.test(text)) opts.push({ num: mm[1], text });
    }
    return opts;
}

/** 由解析到的选项生成按钮 + 回调键；解析失败回退到通用 允许/会话/拒绝/全局 按钮 */
function buildPermissionButtons(parsedOptions) {
    if (!parsedOptions.length) {
        return {
            buttons: [
                { text: '✅ 允许一次', actionType: 'opt_1', color: 'green' },
                { text: '🔓 会话允许', actionType: 'opt_2', color: 'default' },
                { text: '❌ 拒绝', actionType: 'opt_no', color: 'red' },
                { text: '🔓 全局允许', actionType: 'bypass', color: 'default' },
            ],
            responses: {
                opt_1: { keys: '1', label: '已允许' },
                opt_2: { keys: '2', label: '会话允许' },
                opt_no: { keys: '\x1b', label: '已拒绝' },
                bypass: { keys: '1', label: '全局允许' },
            },
        };
    }
    const buttons = parsedOptions.map(o => ({
        text: `${o.num}. ${o.text}`,
        actionType: `opt_${o.num}`,
        color: /^yes/i.test(o.text) ? 'green' : /^no/i.test(o.text) ? 'red' : 'default',
    }));
    buttons.push({ text: '🔓 全局允许', actionType: 'bypass', color: 'default' });
    const responses = { bypass: { keys: '1', label: '全局允许' } };
    parsedOptions.forEach(o => { responses[`opt_${o.num}`] = { keys: o.num, label: o.text }; });
    return { buttons, responses };
}

/** bypass 下 PreToolUse 不触发，从 transcript 检测 AskUserQuestion 并委托 claude-ask 发选择卡。已处理返 true */
async function tryAskUserQuestion(app, data, { sessionPrefix, sessionId, ptsDevice }) {
    const askInput = extractAskUserQuestion(data.transcript_path);
    const questions = Array.isArray(askInput?.questions) ? askInput.questions : [];
    if (!questions.length) return false;

    const { sendSingleSelectCard, sendQuestionsForm } = require('./claude-ask');
    questions.forEach(q => { q._contextText = askInput._contextText || ''; });
    const stateKey = `feishu_ask_${sessionPrefix}_${Date.now()}`;

    // 单题单选 → 按钮卡；其余 → form 卡。两者回放共用 buildReplayPlan
    if (questions.length === 1 && !questions[0].multiSelect) {
        await sendSingleSelectCard(app, questions[0], stateKey, ptsDevice, sessionId, 'AskUserQuestion');
    } else {
        await sendQuestionsForm(app, questions, stateKey, ptsDevice, sessionId, 'AskUserQuestion');
    }
    return true;
}

/** 飞书交互卡片（Notification 事件，带回调按钮）。main 已过滤 idle/elicitation，只剩 permission_prompt */
async function sendFeishuInteractiveCard(data, getStats, ptsDevice) {
    const app = await getFeishuAppClient();
    if (!app) return;

    const sessionId = data.session_id || '';
    const sessionPrefix = sessionId.substring(0, 8);

    // 30s 内 ask-handler（PreToolUse）已发过选择卡 → 跳过重复
    sessionState.load();
    const hasRecentAsk = Object.entries(sessionState.data)
        .some(([k, v]) => k.startsWith(`feishu_ask_${sessionPrefix}`) && Date.now() - (v.created_at || 0) < 30000);
    if (hasRecentAsk) return;

    if (await tryAskUserQuestion(app, data, { sessionPrefix, sessionId, ptsDevice })) return;

    const stateKey = `feishu_${sessionPrefix}_${Date.now()}`;
    const toolDesc = describeLatestTool(data.transcript_path, data.message || '需要你的操作');
    const { buttons, responses } = buildPermissionButtons(parsePermissionOptions(ptsDevice));

    const btns = buttons.map(b => ({ text: b.text, actionType: b.actionType, type: b.color === 'red' ? 'danger' : b.color === 'green' ? 'primary' : 'default' }));
    const card = card2({
        template: 'orange',
        title: '权限确认',
        tags: statsTags(getStats()),
        elements: [
            ...parseMarkdownToElements(toolDesc),
            buttonRow(btns, stateKey),
            inputEl(stateKey),
            footer('claude', ptsDevice),
        ],
    });
    await sendCard(app, card, { stateKey, sessionId, type: data.notification_type || '', ptsDevice, responses });
}

// ── 主流程 ───────────────────────────────────────────────

async function main() {
    const data = await readStdinJson();
    const event = data.hook_event_name;
    if (!event) return;
    if (!feishuEnabled()) return;

    // 终端目标只解析一次（bridge 给了 CLAUDE_TMUX_TARGET 时零开销；否则沿进程树跑 ps）
    const ptsDevice = resolvePtsDevice(process.ppid);
    // SessionStart 让会话一启动/clear/compact 就登记；其它事件顺手刷新。空否交由 ccc back 读 transcript 判断
    registerTmuxSession(ptsDevice, data);

    // 懒求值：statusLine 旁路落盘的官方成本/上下文/限额（与状态栏同源）；没有就不挂标签
    let statsVal, statsDone = false;
    const getStats = () => {
        if (!statsDone) {
            statsVal = readOfficialStats(data.session_id) || {};
            statsDone = true;
        }
        return statsVal;
    };

    if (event === 'Notification') {
        const type = data.notification_type || '';
        if (type === 'permission_prompt') {
            // bypass 模式跳过（Notification payload 不带 mode，看 transcript）
            if (isBypassMode(data)) return;
            sessionState.load();
            const autoDevices = sessionState.data['__meta__']?.autoApproveDevices || [];
            if (autoDevices.includes(ptsDevice)) {
                const { injectKeys } = require('../lib/terminal-inject');
                injectKeys(ptsDevice, '2').catch(() => {});
                return;
            }
        }
        if (type !== 'idle_prompt' && type !== 'elicitation_dialog') {
            await sendFeishuInteractiveCard(data, getStats, ptsDevice);
        }
    } else {
        await sendFeishuAppCard(data, event, getStats, ptsDevice);
    }
}

// require.main 守卫：直接运行时自动跑；被 require 复用导出时由调用方显式 .main()
if (require.main === module) {
    main().catch(err => {
        console.error('Hook handler error:', err.message);
        process.exit(0); // 不要阻塞 Claude
    });
}

module.exports = { main, handleStopFailure, recentApiError, extractAskUserQuestion, registerTmuxSession };

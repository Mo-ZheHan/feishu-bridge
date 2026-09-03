'use strict';

// schema 2.0 卡片构建公共件。交互组件的 value:{action_type,session_state_key} 结构与 1.0 一致，
// listener 回调路由不受影响；2.0 取消了 action 容器，按钮改用 column_set 横排、输入框直接入 body。

// 各主题色默认图标（飞书 standard_icon token）
const TEMPLATE_ICON = {
    green: 'yes_outlined',
    red: 'warning_outlined',
    orange: 'lock_outlined',
    blue: 'code_outlined',
};

/** schema 2.0 卡片信封：header(icon+title+subtitle+彩色标签) + body.elements */
function card2({ template, icon, title, subtitle, tags = [], elements }) {
    const header = { title: { tag: 'plain_text', content: title }, template };
    const tok = icon !== undefined ? icon : TEMPLATE_ICON[template];
    if (tok) header.icon = { tag: 'standard_icon', token: tok };
    if (subtitle) header.subtitle = { tag: 'plain_text', content: subtitle };
    // 真机验证：header 最多显示 3 个标签，多出的静默丢弃；色名须是 2.0 枚举（neutral/orange/red…），grey 会退成默认蓝
    const tagList = tags.filter(Boolean).slice(0, 3)
        .map(t => ({ tag: 'text_tag', text: { tag: 'plain_text', content: t.text }, color: t.color || 'neutral' }));
    if (tagList.length) header.text_tag_list = tagList;
    return { schema: '2.0', config: { wide_screen_mode: true }, header, body: { elements: elements.filter(Boolean) } };
}

/** stats（statusLine 官方字段）→ header 的 3 个标签：上下文占用、5h 限额 ⏳、7d 限额 📅（飞书只显示 3 个）。
 *  限额写成「到重置的时间 (已用%)」，与状态栏同款；已用过半变橙、过八成变红，扫一眼就知道紧不紧 */
function statsTags(stats) {
    if (!stats) return [];
    const { describeQuota, quotaColor } = require('./session-stats');
    const tags = [];
    if (stats.contextPct != null) tags.push({ text: `🧠 ${Math.round(stats.contextPct)}%`, color: 'neutral' });
    for (const [icon, win] of [['⏳', stats.fiveHour], ['📅', stats.sevenDay]]) {
        const q = describeQuota(win);
        if (q) tags.push({ text: `${icon} ${q.text}`, color: quotaColor(q.pct) });
    }
    return tags;
}

/** stats → header 副标题「会话名 · $成本」。成本放这里而不占标签位：三个标签位留给更要紧的上下文和限额 */
function statsSubtitle(stats) {
    if (!stats) return undefined;
    const cost = stats.costUSD > 0 ? `$${stats.costUSD.toFixed(2)}` : '';
    return [stats.sessionName, cost].filter(Boolean).join(' · ') || undefined;
}

/** 输入框（直接放 body.elements） */
function inputEl(stateKey, placeholder = '输入指令...', name = 'user_input', actionType = 'text_input') {
    return { tag: 'input', name, width: 'fill', placeholder: { tag: 'plain_text', content: placeholder }, value: { action_type: actionType, session_state_key: stateKey } };
}

/** 中断按钮 */
function escButton(stateKey) {
    return { tag: 'button', text: { tag: 'plain_text', content: '⛔ 中断' }, type: 'danger', size: 'tiny', value: { action_type: 'interrupt', session_state_key: stateKey } };
}

/** 按钮横排：column_set，每按钮等宽一列。buttons: [{text, actionType, type}] */
function buttonRow(buttons, stateKey) {
    return {
        tag: 'column_set',
        horizontal_spacing: '8px',
        columns: buttons.map(b => ({
            tag: 'column', width: 'weighted', weight: 1,
            elements: [{ tag: 'button', text: { tag: 'plain_text', content: b.text }, type: b.type || 'default', width: 'fill', value: { action_type: b.actionType, session_state_key: stateKey } }],
        })),
    };
}

/** ptsDevice → 简短终端 id：去 tmux:/dev/ 前缀、去容器 server 后缀 @…（terminal-inject 的目标语法）、
 *  去 = 精确匹配前缀，裁默认窗格后缀 :0.0（session 名已唯一）；:N.M 非默认时保留以区分多窗格 */
function termLabel(ptsDevice) {
    if (!ptsDevice) return '';
    const t = String(ptsDevice);
    if (!t.startsWith('tmux:')) return t.replace('/dev/', '');
    return t.slice(5).replace(/@.*$/, '').replace(/^=/, '').replace(/:0\.0$/, '');
}

/** footer：仅留终端 id（多会话分辨用）灰字；无终端则不要 footer。
 *  （schema 2.0 已移除 note 元素，小灰字只能用 markdown+font 实现）*/
function footer(host, ptsDevice) {
    const term = termLabel(ptsDevice);
    if (!term) return null;
    return { tag: 'markdown', content: `<font color='grey'>${term}</font>` };
}

/** 中断按钮 + 终端 id 同行：左按钮、右灰字，省一行；无终端则退化为单按钮行 */
function escFooterRow(stateKey, ptsDevice) {
    const f = footer('', ptsDevice);
    const columns = [{ tag: 'column', width: 'auto', vertical_align: 'center', elements: [escButton(stateKey)] }];
    if (f) columns.push({ tag: 'column', width: 'weighted', weight: 1, vertical_align: 'center', horizontal_align: 'right', elements: [f] });
    return { tag: 'column_set', horizontal_spacing: '8px', columns };
}

module.exports = { card2, statsTags, statsSubtitle, inputEl, escButton, buttonRow, footer, escFooterRow, termLabel };

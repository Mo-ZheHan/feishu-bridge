'use strict';

async function sendLine(deliver, target, value, options = {}) {
    if (options.interruptBeforeText) {
        await deliver(target, '\x03');
    }
    const text = value == null ? '' : String(value);
    if (text) {
        await deliver(target, text);
    }
    // Codex TUI 需要文字先渲染到输入框，再发送 Enter 才能触发提交
    await new Promise(r => setTimeout(r, 100));
    return deliver(target, '\r');
}

function createCodexInputBridge({ deliver }) {
    if (typeof deliver !== 'function') {
        throw new TypeError('createCodexInputBridge requires deliver');
    }

    return {
        async send(response, target, options = {}) {
            if (response?.responseType === 'text') {
                return sendLine(deliver, target, response.value, options);
            }

            if (response?.responseType === 'approve') {
                return sendLine(deliver, target, 'y');
            }

            if (response?.responseType === 'reject') {
                return sendLine(deliver, target, 'n');
            }

            if (response?.responseType === 'select') {
                return sendLine(deliver, target, response.value);
            }

            if (response?.responseType === 'multi_select') {
                const values = Array.isArray(response.values) ? response.values : [];
                return sendLine(deliver, target, values.join(' '));
            }

            if (response?.responseType === 'action' && response.value != null) {
                return sendLine(deliver, target, response.value);
            }

            return null;
        },
    };
}

module.exports = { createCodexInputBridge };

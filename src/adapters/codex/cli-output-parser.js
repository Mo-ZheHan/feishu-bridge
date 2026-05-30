'use strict';

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;
const CSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const OSC_PATTERN = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
const ORPHAN_CSI_PATTERN = /(?:^|[\s(])\[[0-9;?]*[ -/]*[@-~]/g;
const APPROVAL_SUFFIX_PATTERN = /\s*\((?:y\/n|yes\/no)\)\s*$/i;
const NUMBERED_OPTION_PATTERN = /^\s*(\d+|[A-Za-z])[.)、]\s*(.+?)\s*$/;
const CHECKBOX_OPTION_PATTERN = /^\s*\[(?: |x|X)\]\s+(.+?)\s*$/;
const TEXT_INPUT_PATTERN = /^(?:enter|provide|type|input|reply with|respond with|share|give)\b/i;
const OPEN_QUESTION_PATTERN = /^(?:how|what|why|which|where|when|who)\b/i;
const COMPLETION_PATTERN = /\b(done|completed|complete|finished|resolved|successful(?:ly)?|all set|updated \d+ files?)\b|(?:已完成|完成了|处理完成|任务完成|执行完成|搞定)/i;
const NOISE_LINE_PATTERN = /^(?:[•\-\s]*working|thinking|pending|loading|please wait|wait|ok|okay|\d+%?)$/i;

function stripTerminalControl(text) {
    if (typeof text !== 'string' || !text) return '';
    return text
        .replace(OSC_PATTERN, '')
        .replace(CSI_PATTERN, '')
        .replace(ORPHAN_CSI_PATTERN, ' ')
        .replace(/\u001b[@-Z\\-_]/g, '')
        .replace(/\r/g, '\n')
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

function parseNumericToken(value) {
    if (value == null) return null;
    const n = Number.parseInt(String(value).replace(/,/g, ''), 10);
    return Number.isFinite(n) ? n : null;
}

function findTokenValue(text, patterns) {
    for (const pattern of patterns) {
        const m = text.match(pattern);
        if (m && m[1]) {
            const n = parseNumericToken(m[1]);
            if (n != null) return n;
        }
    }
    return null;
}

function normalizeBlock(block) {
    if (typeof block !== 'string') {
        return '';
    }

    return block.replace(ANSI_PATTERN, '').replace(/\r\n/g, '\n');
}

function splitLines(text) {
    return text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
}

function extractQuestion(line) {
    if (!line) {
        return undefined;
    }

    return line.replace(APPROVAL_SUFFIX_PATTERN, '').trim();
}

function parseNumberedOptions(lines) {
    const options = [];

    for (const line of lines) {
        const match = line.match(NUMBERED_OPTION_PATTERN);
        if (!match) {
            return [];
        }

        options.push({
            label: match[2].trim(),
            value: match[1],
        });
    }

    return options;
}

function parseCheckboxOptions(lines) {
    const options = [];

    for (const line of lines) {
        const match = line.match(CHECKBOX_OPTION_PATTERN);
        if (!match) {
            return [];
        }

        const label = match[1].trim();
        options.push({
            label,
            value: label,
        });
    }

    return options;
}

function isConfirmOptions(options) {
    if (options.length !== 2) {
        return false;
    }

    const labels = options.map((option) => option.label.toLowerCase());
    return labels.includes('yes') && labels.includes('no');
}

function parseOutputBlock(block) {
    const text = normalizeBlock(block);
    const trimmed = text.trim();

    if (!trimmed) {
        return { kind: 'none', confidence: 'low', rawBlock: block };
    }

    const lines = splitLines(trimmed);
    const question = extractQuestion(lines[0]);
    const remainingLines = lines.slice(1);

    if (remainingLines.length >= 2) {
        const checkboxOptions = parseCheckboxOptions(remainingLines);
        if (checkboxOptions.length === remainingLines.length) {
            return {
                kind: 'multi_select',
                confidence: 'high',
                question,
                options: checkboxOptions,
                allowFreeText: false,
                rawBlock: block,
            };
        }

        const numberedOptions = parseNumberedOptions(remainingLines);
        if (numberedOptions.length === remainingLines.length) {
            return {
                kind: isConfirmOptions(numberedOptions) ? 'confirm' : 'single_select',
                confidence: 'high',
                question,
                options: numberedOptions,
                rawBlock: block,
            };
        }
    }

    if (APPROVAL_SUFFIX_PATTERN.test(lines[0])) {
        return {
            kind: 'approval',
            confidence: 'high',
            question,
            rawBlock: block,
        };
    }

    if (TEXT_INPUT_PATTERN.test(lines[0])) {
        return {
            kind: 'text_input',
            confidence: 'medium',
            question: lines[0],
            rawBlock: block,
        };
    }

    if (lines.length === 1 && OPEN_QUESTION_PATTERN.test(lines[0]) && /[?]$/.test(lines[0])) {
        return {
            kind: 'open_question',
            confidence: 'medium',
            question: lines[0],
            rawBlock: block,
        };
    }

    return { kind: 'none', confidence: 'low', rawBlock: block };
}

function parseExecutionSummary(block) {
    if (typeof block !== 'string' || !block.trim()) {
        return null;
    }

    const cleaned = stripTerminalControl(block);
    if (!cleaned.trim()) return null;

    const lines = cleaned
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    if (!lines.length) return null;

    const joined = lines.join('\n');
    const cwdMatch = joined.match(/(?:cwd|current(?:\s+working)?\s+directory|working\s+directory|当前目录|工作目录)\s*[:=：]\s*(.+)$/im);
    const cwd = cwdMatch?.[1]?.trim() || null;

    const input = findTokenValue(joined, [
        /\binput(?:\s+tokens?)?\s*[:=]\s*([0-9][0-9,]*)\b/i,
        /\bprompt(?:\s+tokens?)?\s*[:=]\s*([0-9][0-9,]*)\b/i,
        /输入\s*tokens?\s*[:=：]\s*([0-9][0-9,]*)/i,
    ]);
    const output = findTokenValue(joined, [
        /\boutput(?:\s+tokens?)?\s*[:=]\s*([0-9][0-9,]*)\b/i,
        /\bcompletion(?:\s+tokens?)?\s*[:=]\s*([0-9][0-9,]*)\b/i,
        /输出\s*tokens?\s*[:=：]\s*([0-9][0-9,]*)/i,
    ]);
    let total = findTokenValue(joined, [
        /\btotal(?:\s+tokens?)?\s*[:=]\s*([0-9][0-9,]*)\b/i,
        /\btokens?\s+used\s*[:=]\s*([0-9][0-9,]*)\b/i,
        /总\s*tokens?\s*[:=：]\s*([0-9][0-9,]*)/i,
        /总计\s*tokens?\s*[:=：]\s*([0-9][0-9,]*)/i,
    ]);
    if (total == null && input != null && output != null) {
        total = input + output;
    }

    const summaryLines = lines.filter((line) => {
        const lower = line.toLowerCase();
        if (/^(cwd|current(?:\s+working)?\s+directory|working\s+directory|当前目录|工作目录)\s*[:=：]/i.test(line)) return false;
        if (/\b(input|output|total|prompt|completion)\s+tokens?\s*[:=]/i.test(line)) return false;
        if (/\btokens?\s+used\s*[:=]/i.test(line)) return false;
        if (/^(输入|输出|总|总计)\s*tokens?\s*[:=：]/i.test(line)) return false;
        if (/^(yes|no|y|n)$/i.test(lower)) return false;
        if (/^\[[0-9;?]*[ -/]*[@-~]$/.test(line)) return false;
        if (/^[\d\s.,:;!?`~@#$%^&*()_+\-=[\]{}|\\/<>]+$/.test(line)) return false;
        if (NOISE_LINE_PATTERN.test(lower)) return false;
        return true;
    });
    const summary = summaryLines.join('\n');

    const hasTokenData = input != null || output != null || total != null;
    const looksComplete = COMPLETION_PATTERN.test(joined);
    const hasMeaningfulText = summaryLines.some((line) => /[A-Za-z0-9\u4e00-\u9fff]/.test(line));
    if (!hasTokenData && !looksComplete && !hasMeaningfulText) {
        return null;
    }

    const tokens = {};
    if (input != null) tokens.input = input;
    if (output != null) tokens.output = output;
    if (total != null) tokens.total = total;

    return {
        summary,
        cwd,
        tokens,
    };
}

module.exports = { parseOutputBlock, parseExecutionSummary };

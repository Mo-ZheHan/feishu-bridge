'use strict';

const fs = require('node:fs');

const FEED_PATH = '/tmp/codex-assistant-feed.jsonl';

function parseArg(name) {
    const idx = process.argv.indexOf(name);
    if (idx === -1) return null;
    return process.argv[idx + 1] || null;
}

function main() {
    const text = parseArg('--text') || process.env.CODEX_FEED_TEXT || '';
    const pts = parseArg('--pts') || process.env.CODEX_FEED_PTS || null;
    const cwd = parseArg('--cwd') || process.env.CODEX_FEED_CWD || null;
    const assistantKey = parseArg('--assistant-key') || process.env.CODEX_FEED_ASSISTANT_KEY || null;
    const newTaskRaw = parseArg('--new-task');

    if (!text.trim()) {
        throw new Error('需要 --text 或 CODEX_FEED_TEXT');
    }

    const payload = {
        pts_device: pts,
        cwd,
        text: text.trim(),
        assistant_key: assistantKey,
        ts: Date.now(),
    };
    if (newTaskRaw != null) {
        payload.new_task = !['0', 'false', 'no'].includes(String(newTaskRaw).toLowerCase());
    }

    fs.appendFileSync(FEED_PATH, JSON.stringify(payload) + '\n', 'utf8');
    console.log(`[codex-feed] 写入成功 -> ${FEED_PATH}`);
}

if (require.main === module) {
    try {
        main();
    } catch (err) {
        console.error('[codex-feed] 失败:', err.message);
        process.exit(1);
    }
}

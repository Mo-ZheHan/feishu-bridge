'use strict';

const fs = require('fs');

// 首个读窗 256 KB，不够就向前翻倍。transcript 会长到几百 MB（一个长会话 300 MB+），而每次
// 工具调用的 flush 和每次 Stop 都要看它——整文件 readFileSync + split 是每次几百 MB 的分配。
const WINDOW = 256 * 1024;

/**
 * 从文件尾部倒序交付完整行，callback 返 true 即止；窗口不够时向前扩，跨窗口边界的行只在
 * 它完整落入窗口后交付一次——累加型扫描（handleStop 拼正文）依赖"无重叠、无遗漏"。
 * 切分按字节找 \n，被截断的首段留给下一轮，所以多字节字符从不会在半截处被解码。
 */
function forEachTailLine(filePath, callback) {
    if (!filePath) return;
    let fd;
    try { fd = fs.openSync(filePath, 'r'); } catch { return; }
    try {
        let end = fs.fstatSync(fd).size; // 尚未交付区域的末端；其后的字节都已作为完整行交付
        let window = WINDOW;
        while (end > 0) {
            const start = Math.max(0, end - window);
            const buf = Buffer.alloc(end - start);
            fs.readSync(fd, buf, 0, end - start, start);
            const nl = start > 0 ? buf.indexOf(0x0a) : -1;
            if (start > 0 && nl < 0) { window *= 2; continue; } // 整窗都是一行的尾巴，继续扩
            const region = start > 0 ? buf.subarray(nl + 1) : buf;
            const lines = region.toString('utf8').split('\n');
            if (region.length && region[region.length - 1] === 0x0a) lines.pop(); // 尾 \n 之后不是一行
            for (let i = lines.length - 1; i >= 0; i--) {
                if (callback(lines[i]) === true) return;
            }
            if (start === 0) return;
            end = start + nl + 1;
            window *= 2;
        }
    } catch {
    } finally {
        fs.closeSync(fd);
    }
}

/** 反扫 transcript：每条记录（JSON 解析失败跳过）调 callback，返 true 终止 */
function forEachTail(transcriptPath, callback) {
    forEachTailLine(transcriptPath, (line) => {
        let d;
        try { d = JSON.parse(line); } catch { return false; }
        try { return callback(d) === true; } catch { return false; }
    });
}

/** 反扫找首个 predicate 返非 undefined 的结果；没有则 undefined */
function findTail(transcriptPath, predicate) {
    let result;
    forEachTail(transcriptPath, (d) => {
        const r = predicate(d);
        if (r === undefined) return false;
        result = r;
        return true;
    });
    return result;
}

/** 当前 turn（上一条 user prompt 之后）的记录，按文件顺序；boundary 为该 prompt 记录（没有则 null） */
function currentTurn(transcriptPath) {
    const records = [];
    let boundary = null;
    forEachTail(transcriptPath, (d) => {
        if (d.type === 'user' && typeof d.message?.content === 'string') { boundary = d; return true; }
        records.push(d);
        return false;
    });
    records.reverse();
    return { boundary, records };
}

/** 单条 assistant message 内所有 text block 拼接（跳过 tool_use / thinking） */
function getAssistantText(d) {
    return (d?.message?.content || [])
        .filter(b => b.type === 'text' && b.text?.trim())
        .map(b => b.text).join('\n').trim();
}

module.exports = { forEachTailLine, forEachTail, findTail, currentTurn, getAssistantText };

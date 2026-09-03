'use strict';

/** hook 的 stdin 是一份 JSON；解析失败或 3 秒没等到 EOF 都当空对象，绝不卡住 Claude */
function readStdinJson() {
    return new Promise((resolve) => {
        let data = '';
        let done = false;
        const finish = (val) => { if (!done) { done = true; resolve(val); } };
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', chunk => data += chunk);
        process.stdin.on('end', () => { try { finish(JSON.parse(data)); } catch { finish({}); } });
        setTimeout(() => finish({}), 3000).unref(); // .unref() 让 timer 不阻塞进程退出
    });
}

module.exports = { readStdinJson };

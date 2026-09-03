'use strict';

/**
 * 加载仓库根的 .env 进 process.env（dotenv）。所有入口都先 require 本模块，再读飞书凭据。
 * 已有的系统环境变量优先（dotenv 不覆盖），所以 bridge 之类的调用方仍能逐次注入 CLAUDE_* 变量。
 */

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '..', '.env'); // __dirname = src/lib，.env 在仓库根
try {
    require('dotenv').config({ path: fs.existsSync(envPath) ? envPath : undefined, quiet: true });
} catch (err) {
    console.error('[env-config] 环境变量加载失败:', err.message);
}

/** 飞书自建应用是否配好（两个凭据齐全） */
function feishuEnabled() {
    return !!(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET);
}

module.exports = { feishuEnabled };

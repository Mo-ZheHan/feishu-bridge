'use strict';

// claude-hook 的 main 用 require.main 守卫（供其导出被复用而不触发 main），此处显式调用
require('./src/apps/claude-hook').main().catch(err => {
    console.error('Hook handler error:', err.message);
    process.exit(0); // 不要阻塞 Claude
});

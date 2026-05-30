'use strict';

const app = require('./src/apps/feishu-listener');

if (require.main === module) {
    app.main();
}

module.exports = app;

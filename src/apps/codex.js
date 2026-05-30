'use strict';

const { launchCodex } = require('../adapters/codex/cli-launcher');

function main(argv = process.argv.slice(2)) {
    return launchCodex({ args: argv });
}

module.exports = { main };

if (require.main === module) {
    main();
}

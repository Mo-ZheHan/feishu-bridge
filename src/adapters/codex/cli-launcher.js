'use strict';

const { spawn } = require('node:child_process');

function launchCodex({ args = [], env = process.env } = {}) {
    return spawn('codex', args, { stdio: 'pipe', env });
}

module.exports = { launchCodex };

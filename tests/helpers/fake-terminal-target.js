'use strict';

function createFakeTerminalTarget(seed = {}) {
    const deliveries = [];
    return {
        kind: 'fake-terminal',
        ...seed,
        sent: deliveries,
        deliveries,
        async injectText(_target, text) {
            deliveries.push(text);
            return true;
        },
    };
}

module.exports = { createFakeTerminalTarget };

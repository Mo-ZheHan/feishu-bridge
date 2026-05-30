'use strict';

const EventEmitter = require('node:events');

function createEventBus() {
    return new EventEmitter();
}

module.exports = { createEventBus };

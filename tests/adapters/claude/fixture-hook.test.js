'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('../../fixtures/claude/hook-stop.json');
const { translateHookPayload } = require('../../../src/adapters/claude/hook-adapter');

test('hook adapter translates stop fixture to unified task result event', () => {
  const event = translateHookPayload(fixture);

  assert.equal(event.host, 'claude');
  assert.equal(event.sessionId, 'claude_abc123');
  assert.equal(event.eventType, 'task_result');
  assert.equal(event.title, 'Stop');
  assert.equal(event.message, 'Task finished successfully');
  assert.deepEqual(event.meta, {
    cwd: '/tmp/demo',
    transport: 'hooks',
    error: undefined,
    errorDetails: undefined,
    lastAssistantMessage: 'Task finished successfully',
  });
  assert.equal(typeof event.createdAt, 'number');
});

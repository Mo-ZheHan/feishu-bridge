'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('../../fixtures/claude/live-post-tool.json');
const { translateLivePayload } = require('../../../src/adapters/claude/live-adapter');

test('live adapter translates post-tool fixture to unified live status event', () => {
  const event = translateLivePayload(fixture);

  assert.equal(event.host, 'claude');
  assert.equal(event.sessionId, 'claude_abc123');
  assert.equal(event.eventType, 'live_status');
  assert.equal(event.title, 'PostToolUse');
  assert.equal(event.message, 'Bash');
  assert.equal(event.rawText, '{"command":"npm test"}');
  assert.deepEqual(event.meta, {
    cwd: '/tmp/demo',
    transport: 'hooks',
    toolName: 'Bash',
    toolResponse: 'All tests passed',
  });
  assert.equal(typeof event.createdAt, 'number');
});

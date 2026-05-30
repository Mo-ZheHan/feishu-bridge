'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('../../fixtures/claude/ask-user-question.json');
const { translateAskPayload } = require('../../../src/adapters/claude/ask-adapter');

test('ask adapter translates question fixture to unified input request event', () => {
  const event = translateAskPayload(fixture);

  assert.equal(event.host, 'claude');
  assert.equal(event.sessionId, 'claude_abc123');
  assert.equal(event.eventType, 'input_request');
  assert.equal(event.title, 'Claude question');
  assert.deepEqual(event.prompt, {
    kind: 'single_select',
    question: 'Which option should I use?',
    options: [
      { label: 'Option A', value: 'option-a' },
      { label: 'Option B', value: 'option-b' },
    ],
    allowFreeText: true,
  });
  assert.deepEqual(event.meta, {
    transport: 'hooks',
    hookEventName: 'PreToolUse',
    toolName: 'AskUserQuestion',
  });
  assert.equal(typeof event.createdAt, 'number');
});

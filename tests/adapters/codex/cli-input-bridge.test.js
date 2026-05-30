const test = require('node:test');
const assert = require('node:assert/strict');
const { createCodexInputBridge } = require('../../../src/adapters/codex/cli-input-bridge');

test('codex input bridge turns text response into terminal payload', async () => {
  const delivered = [];
  const bridge = createCodexInputBridge({
    deliver: async (_target, value) => delivered.push(value),
  });

  await bridge.send({ responseType: 'text', value: 'continue' }, { ptsDevice: '/dev/pts/1' });

  assert.deepEqual(delivered, ['continue', '\r']);
});

test('codex input bridge interrupts before sending live-summary text when requested', async () => {
  const delivered = [];
  const bridge = createCodexInputBridge({
    deliver: async (_target, value) => delivered.push(value),
  });

  await bridge.send(
    { responseType: 'text', value: 'continue' },
    { ptsDevice: '/dev/pts/1' },
    { interruptBeforeText: true }
  );

  assert.deepEqual(delivered, ['\x03', 'continue', '\r']);
});

test('codex input bridge turns approve, reject, and select responses into terminal payloads', async () => {
  const delivered = [];
  const bridge = createCodexInputBridge({
    deliver: async (_target, value) => delivered.push(value),
  });
  const target = { ptsDevice: '/dev/pts/1' };

  await bridge.send({ responseType: 'approve' }, target);
  await bridge.send({ responseType: 'reject' }, target);
  await bridge.send({ responseType: 'select', value: 'option-a' }, target);

  assert.deepEqual(delivered, ['y', '\r', 'n', '\r', 'option-a', '\r']);
});

test('codex input bridge turns multi_select and action responses into terminal payloads', async () => {
  const delivered = [];
  const bridge = createCodexInputBridge({
    deliver: async (_target, value) => delivered.push(value),
  });
  const target = { ptsDevice: '/dev/pts/1' };

  await bridge.send({ responseType: 'multi_select', values: ['1', '3', 'other:abc'] }, target);
  await bridge.send({ responseType: 'action', value: 'continue' }, target);

  assert.deepEqual(delivered, ['1 3 other:abc', '\r', 'continue', '\r']);
});

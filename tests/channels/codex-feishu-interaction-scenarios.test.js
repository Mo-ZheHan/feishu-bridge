const test = require('node:test');
const assert = require('node:assert/strict');
const { createFeishuInteractionHandler } = require('../../src/channels/feishu/feishu-interaction-handler');
const { createCodexInputBridge } = require('../../src/adapters/codex/cli-input-bridge');

function buildPipeline() {
  const injected = [];
  const bridge = createCodexInputBridge({
    deliver: async (_target, value) => {
      injected.push(value);
      return true;
    },
  });

  const handler = createFeishuInteractionHandler({
    resolveInteraction: async () => ({ sessionId: 'codex_s1', host: 'codex' }),
    onResponse: async (response) => {
      await bridge.send(response, { ptsDevice: '/dev/pts/9' });
    },
  });

  return { handler, injected };
}

test('codex feishu scenario: text input', async () => {
  const { handler, injected } = buildPipeline();

  await handler.handleCardAction({
    action: {
      tag: 'input',
      input_value: 'continue with migration',
      value: { session_state_key: 'k1', action_type: 'text_submit' },
    },
  });

  assert.deepEqual(injected, ['continue with migration', '\r']);
});

test('codex feishu scenario: approval and reject', async () => {
  const { handler, injected } = buildPipeline();

  await handler.handleCardAction({
    action: { value: { session_state_key: 'k2', action_type: 'allow' } },
  });
  await handler.handleCardAction({
    action: { value: { session_state_key: 'k3', action_type: 'deny' } },
  });

  assert.deepEqual(injected, ['y', '\r', 'n', '\r']);
});

test('codex feishu scenario: single select', async () => {
  const { handler, injected } = buildPipeline();

  await handler.handleCardAction({
    action: {
      value: {
        session_state_key: 'k4',
        action_type: 'single_select',
        selected_values: ['option-b'],
      },
    },
  });

  assert.deepEqual(injected, ['option-b', '\r']);
});

test('codex feishu scenario: multi select', async () => {
  const { handler, injected } = buildPipeline();

  await handler.handleCardAction({
    action: {
      value: {
        session_state_key: 'k5',
        action_type: 'submit_multi',
        selected_values: ['1', '3', 'other:custom'],
      },
    },
  });

  assert.deepEqual(injected, ['1 3 other:custom', '\r']);
});

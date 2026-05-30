const test = require('node:test');
const assert = require('node:assert/strict');
const { createFeishuInteractionHandler } = require('../../src/channels/feishu/feishu-interaction-handler');
const { renderSessionHeader } = require('../../src/channels/feishu/feishu-card-renderer');

test('interaction handler converts callback payload into unified user response', async () => {
  let captured = null;
  const handler = createFeishuInteractionHandler({
    resolveInteraction: () => ({ key: 'k1', sessionId: 'codex_a1', host: 'codex' }),
    onResponse: async (response) => {
      captured = response;
    },
  });

  await handler.handleCardAction({
    action: {
      value: {
        session_state_key: 'k1',
        action_type: 'text_submit',
        input_value: 'continue',
      },
    },
  });

  assert.deepEqual(captured, {
    interactionKey: 'k1',
    sessionId: 'codex_a1',
    host: 'codex',
    responseType: 'text',
    value: 'continue',
  });
});

test('interaction handler reads text from form_value on submit button callbacks', async () => {
  let captured = null;
  const handler = createFeishuInteractionHandler({
    resolveInteraction: () => ({ key: 'k1b', sessionId: 'codex_a1b', host: 'codex' }),
    onResponse: async (response) => {
      captured = response;
    },
  });

  await handler.handleCardAction({
    action: {
      value: {
        session_state_key: 'k1b',
        action_type: 'text_submit',
      },
      form_value: {
        user_input: 'continue via button',
      },
    },
  });

  assert.deepEqual(captured, {
    interactionKey: 'k1b',
    sessionId: 'codex_a1b',
    host: 'codex',
    responseType: 'text',
    value: 'continue via button',
  });
});

test('interaction handler maps approval callbacks to approve responses', async () => {
  let captured = null;
  const handler = createFeishuInteractionHandler({
    resolveInteraction: () => ({ key: 'k2', sessionId: 'codex_a2', host: 'codex' }),
    onResponse: async (response) => {
      captured = response;
    },
  });

  await handler.handleCardAction({
    action: {
      value: {
        session_state_key: 'k2',
        action_type: 'allow',
      },
    },
  });

  assert.deepEqual(captured, {
    interactionKey: 'k2',
    sessionId: 'codex_a2',
    host: 'codex',
    responseType: 'approve',
    value: 'allow',
  });
});

test('interaction handler maps selected values to select responses', async () => {
  let captured = null;
  const handler = createFeishuInteractionHandler({
    resolveInteraction: () => ({ key: 'k3', sessionId: 'codex_a3', host: 'codex' }),
    onResponse: async (response) => {
      captured = response;
    },
  });

  await handler.handleCardAction({
    action: {
      value: {
        session_state_key: 'k3',
        action_type: 'single_select',
        selected_values: ['option-a'],
      },
    },
  });

  assert.deepEqual(captured, {
    interactionKey: 'k3',
    sessionId: 'codex_a3',
    host: 'codex',
    responseType: 'select',
    value: 'option-a',
  });
});

test('interaction handler maps multi-selected values to multi_select responses', async () => {
  let captured = null;
  const handler = createFeishuInteractionHandler({
    resolveInteraction: () => ({ key: 'k4', sessionId: 'codex_a4', host: 'codex' }),
    onResponse: async (response) => {
      captured = response;
    },
  });

  await handler.handleCardAction({
    action: {
      value: {
        session_state_key: 'k4',
        action_type: 'submit_multi',
        selected_values: ['option-a', 'option-c'],
      },
    },
  });

  assert.deepEqual(captured, {
    interactionKey: 'k4',
    sessionId: 'codex_a4',
    host: 'codex',
    responseType: 'multi_select',
    values: ['option-a', 'option-c'],
  });
});

test('renderSessionHeader coerces non-string session ids before slicing', () => {
  assert.equal(
    renderSessionHeader({
      host: 'codex',
      status: 'active',
      id: 1234567890123,
      terminal: { ptsDevice: 'pts/1' },
    }),
    'Codex | active | 123456789012 | pts/1'
  );
});

test('renderSessionHeader reads top-level pts_device when session terminal is absent', () => {
  assert.equal(
    renderSessionHeader({
      host: 'codex',
      status: 'active',
      id: 'codex_a123',
      pts_device: 'pts/7',
    }),
    'Codex | active | codex_a123 | pts/7'
  );
});

'use strict';

const { EVENT_TYPES, HOSTS } = require('../../core/event-types');

function translateAskPayload(payload = {}) {
  const questions = Array.isArray(payload.tool_input?.questions)
    ? payload.tool_input.questions
    : Array.isArray(payload.questions)
      ? payload.questions
      : [];
  const question = questions[0] || {};
  const options = Array.isArray(question.options)
    ? question.options
    : Array.isArray(question.choices)
      ? question.choices
      : [];
  const kind = options.length > 0
    ? (question.multiSelect ? 'multi_select' : 'single_select')
    : 'open_question';

  return {
    host: HOSTS.CLAUDE,
    sessionId: payload.session_id ? `claude_${payload.session_id}` : 'claude_unknown',
    eventType: EVENT_TYPES.INPUT_REQUEST,
    title: 'Claude question',
    prompt: {
      kind,
      question: question.question || '',
      options: options.length > 0
        ? options.map((option) => ({
            label: option.label || option.value || '',
            value: option.value || option.label || '',
          }))
        : undefined,
      allowFreeText: true,
    },
    meta: {
      transport: 'hooks',
      hookEventName: payload.hook_event_name,
      toolName: payload.tool_name,
    },
    createdAt: Date.now(),
  };
}

module.exports = { translateAskPayload };

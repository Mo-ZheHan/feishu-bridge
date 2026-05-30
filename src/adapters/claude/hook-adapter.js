'use strict';

const { EVENT_TYPES, HOSTS } = require('../../core/event-types');

function translateHookPayload(payload = {}) {
  const message =
    payload.last_assistant_message ||
    payload.message ||
    payload.error_details ||
    payload.stop_reason ||
    payload.status ||
    '';

  return {
    host: HOSTS.CLAUDE,
    sessionId: payload.session_id ? `claude_${payload.session_id}` : 'claude_unknown',
    eventType: EVENT_TYPES.TASK_RESULT,
    title: payload.hook_event_name || 'Claude event',
    message,
    meta: {
      cwd: payload.cwd,
      transport: 'hooks',
      error: payload.error,
      errorDetails: payload.error_details,
      lastAssistantMessage: payload.last_assistant_message,
    },
    createdAt: Date.now(),
  };
}

module.exports = { translateHookPayload };

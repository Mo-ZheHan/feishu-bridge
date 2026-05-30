'use strict';

const { EVENT_TYPES, HOSTS } = require('../../core/event-types');

function formatRawToolInput(toolInput) {
  if (typeof toolInput === 'string') return toolInput;
  if (toolInput == null) return '';
  try {
    return JSON.stringify(toolInput);
  } catch {
    return String(toolInput);
  }
}

function translateLivePayload(payload = {}) {
  return {
    host: HOSTS.CLAUDE,
    sessionId: payload.session_id ? `claude_${payload.session_id}` : 'claude_unknown',
    eventType: EVENT_TYPES.LIVE_STATUS,
    title: payload.hook_event_name || 'Claude live event',
    message: payload.tool_name || '',
    rawText: formatRawToolInput(payload.tool_input),
    meta: {
      cwd: payload.cwd,
      transport: 'hooks',
      toolName: payload.tool_name,
      toolResponse: payload.tool_response ?? payload.tool_result ?? '',
    },
    createdAt: Date.now(),
  };
}

module.exports = { translateLivePayload };

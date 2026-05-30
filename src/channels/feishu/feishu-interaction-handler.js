'use strict';

const APPROVE_ACTION_TYPES = new Set(['allow', 'approve', 'confirm', 'ok', 'yes', 'submit']);
const REJECT_ACTION_TYPES = new Set(['deny', 'reject', 'cancel', 'decline', 'no']);
const SELECT_ACTION_TYPES = new Set(['select', 'single_select']);
const MULTI_SELECT_ACTION_TYPES = new Set(['multi_select', 'submit_multi']);

function normalizeSelectedValues(value = {}) {
    const selectedValues = value.selected_values ?? value.selectedValues ?? value.selected_value ?? value.selectedValue ?? value.selected;
    if (Array.isArray(selectedValues)) return selectedValues.filter((entry) => entry != null).map((entry) => String(entry));
    if (selectedValues == null || selectedValues === '') return [];
    return [String(selectedValues)];
}

function resolveResponseType(actionType, selectedValues, isTextResponse) {
    if (isTextResponse || actionType === 'text_submit' || actionType === 'text_input') {
        return 'text';
    }

    if (selectedValues.length > 1 || MULTI_SELECT_ACTION_TYPES.has(actionType)) {
        return 'multi_select';
    }

    if (selectedValues.length === 1 || SELECT_ACTION_TYPES.has(actionType)) {
        return 'select';
    }

    if (APPROVE_ACTION_TYPES.has(actionType)) {
        return 'approve';
    }

    if (REJECT_ACTION_TYPES.has(actionType)) {
        return 'reject';
    }

    return actionType ? 'action' : 'text';
}

function resolveActionPayload(payload) {
    const action = payload?.action || {};
    const value = action.value || {};
    const formValue = action.form_value?.user_input
        ?? action.formValue?.user_input
        ?? payload?.form_value?.user_input
        ?? payload?.formValue?.user_input
        ?? null;
    const rawValue = action.input_value ?? value.input_value ?? formValue;
    const selectedValues = normalizeSelectedValues(value);

    return {
        action,
        key: value.session_state_key,
        actionType: value.action_type,
        rawValue,
        selectedValues,
        isTextResponse: action.tag === 'input' || Object.prototype.hasOwnProperty.call(action, 'input_value') || Object.prototype.hasOwnProperty.call(value, 'input_value'),
    };
}

function createFeishuInteractionHandler({ resolveInteraction, onResponse }) {
    if (typeof resolveInteraction !== 'function') {
        throw new TypeError('createFeishuInteractionHandler requires resolveInteraction');
    }

    if (typeof onResponse !== 'function') {
        throw new TypeError('createFeishuInteractionHandler requires onResponse');
    }

    return {
        async handleCardAction(payload) {
            const { key, actionType, rawValue, selectedValues, isTextResponse } = resolveActionPayload(payload);
            if (!key) return null;

            const interaction = await resolveInteraction(key, payload);
            if (!interaction) return null;
            const responseType = resolveResponseType(actionType, selectedValues, isTextResponse);
            const responseValue = responseType === 'text'
                ? (rawValue || '')
                : responseType === 'multi_select'
                    ? undefined
                    : (selectedValues[0] || actionType);

            const response = {
                interactionKey: key,
                sessionId: interaction.sessionId,
                host: interaction.host,
                responseType,
                value: responseValue,
            };

            if (responseType === 'multi_select' && selectedValues.length > 0) {
                response.values = selectedValues;
                delete response.value;
            }

            await onResponse(response, payload, interaction);
            return response;
        },
    };
}

module.exports = { createFeishuInteractionHandler };

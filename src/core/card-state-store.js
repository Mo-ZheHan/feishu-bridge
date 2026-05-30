'use strict';

function cloneCard(card) {
    if (!card) return null;
    return {
        ...card,
        options: Array.isArray(card.options)
            ? card.options.map((option) => ({ ...option }))
            : card.options,
    };
}

function cloneCardPatch(patch) {
    if (!patch) return {};

    const next = { ...patch };
    delete next.key;

    if (!Object.prototype.hasOwnProperty.call(patch, 'options')) {
        delete next.options;
        return next;
    }

    next.options = Array.isArray(patch.options)
        ? patch.options.map((option) => ({ ...option }))
        : patch.options;

    return next;
}

function createCardStateStore(initial = []) {
    const cards = new Map();

    const seed = initial instanceof Map ? initial.values() : initial;
    for (const card of seed) {
        if (card && card.key) {
            cards.set(card.key, cloneCard(card));
        }
    }

    return {
        open(card) {
            if (!card || !card.key) return null;

            const next = {
                ...cloneCard(card),
                status: card.status || 'open',
            };

            cards.set(card.key, next);
            return cloneCard(next);
        },

        update(key, patch) {
            const current = cards.get(key);
            if (!current) return null;

            const next = {
                ...current,
                ...cloneCardPatch(patch),
                key: current.key,
            };

            cards.set(key, next);
            return cloneCard(next);
        },

        get(key) {
            return cloneCard(cards.get(key) || null);
        },

        listOpenBySession(sessionId) {
            return [...cards.values()]
                .filter((card) => card.sessionId === sessionId && card.status === 'open')
                .map(cloneCard);
        },
    };
}

module.exports = { createCardStateStore };

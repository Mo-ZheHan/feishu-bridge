'use strict';

function cloneSession(session) {
    if (!session) return null;
    return {
        ...session,
        terminal: session.terminal ? { ...session.terminal } : session.terminal,
    };
}

function createSessionStore(initial = []) {
    const sessions = new Map();

    const seed = initial instanceof Map ? initial.values() : initial;
    for (const session of seed) {
        if (session && session.id) {
            sessions.set(session.id, cloneSession(session));
        }
    }

    return {
        upsert(session) {
            if (!session || !session.id) return null;

            const current = sessions.get(session.id) || {};
            const next = {
                ...current,
                ...cloneSession(session),
                terminal: session.terminal
                    ? { ...(current.terminal || {}), ...session.terminal }
                    : current.terminal,
            };

            sessions.set(session.id, next);
            return cloneSession(next);
        },

        get(id) {
            return cloneSession(sessions.get(id) || null);
        },

        listByHost(host) {
            return [...sessions.values()]
                .filter((session) => session.host === host)
                .map(cloneSession);
        },
    };
}

module.exports = { createSessionStore };

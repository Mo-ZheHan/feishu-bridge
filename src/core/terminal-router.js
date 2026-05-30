'use strict';

function seedTargets(targets, initial) {
    if (!initial) return targets;

    if (initial instanceof Map) {
        for (const [sessionId, target] of initial.entries()) {
            if (sessionId) {
                targets.set(sessionId, target);
            }
        }
        return targets;
    }

    if (Array.isArray(initial)) {
        for (const entry of initial) {
            if (!entry) continue;
            const [sessionId, target] = entry;
            if (sessionId) {
                targets.set(sessionId, target);
            }
        }
        return targets;
    }

    if (typeof initial === 'object') {
        for (const [sessionId, target] of Object.entries(initial)) {
            if (sessionId) {
                targets.set(sessionId, target);
            }
        }
    }

    return targets;
}

function createTerminalRouter(initial = new Map()) {
    const targets = seedTargets(new Map(), initial);

    return {
        register(sessionId, target) {
            if (!sessionId) return null;

            if (target == null) {
                targets.delete(sessionId);
                return null;
            }

            targets.set(sessionId, target);
            return target;
        },

        resolve(sessionId) {
            return targets.get(sessionId) || null;
        },
    };
}

module.exports = { createTerminalRouter };

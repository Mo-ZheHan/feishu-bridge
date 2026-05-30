'use strict';

function createCodexSessionManager({ sessionStore, terminalRouter }) {
    return {
        start({ sessionId, terminal, cwd }) {
            const now = Date.now();
            const session = sessionStore.upsert({
                id: sessionId,
                host: 'codex',
                status: 'running',
                title: 'Codex CLI',
                cwd,
                transport: 'cli',
                terminal,
                createdAt: now,
                updatedAt: now,
            });

            terminalRouter.register(sessionId, terminal);
            return session;
        },
    };
}

module.exports = { createCodexSessionManager };

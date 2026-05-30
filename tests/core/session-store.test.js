const test = require('node:test');
const assert = require('node:assert/strict');
const { createSessionStore } = require('../../src/core/session-store');

test('session store namespaces sessions by host', () => {
  const store = createSessionStore();

  store.upsert({
    id: 'claude_a1',
    host: 'claude',
    status: 'running',
    title: 'Claude run',
    transport: 'hooks',
    terminal: {},
    createdAt: 1,
    updatedAt: 1,
  });

  store.upsert({
    id: 'codex_a1',
    host: 'codex',
    status: 'running',
    title: 'Codex run',
    transport: 'cli',
    terminal: {},
    createdAt: 2,
    updatedAt: 2,
  });

  assert.equal(store.get('claude_a1').host, 'claude');
  assert.equal(store.get('codex_a1').host, 'codex');
  assert.equal(store.listByHost('claude').length, 1);
  assert.equal(store.listByHost('codex').length, 1);
});

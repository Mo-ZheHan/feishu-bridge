const test = require('node:test');
const assert = require('node:assert/strict');
const { createCardStateStore } = require('../../src/core/card-state-store');

test('card state store keeps multiple open cards for one session', () => {
  const store = createCardStateStore();

  store.open({ key: 'c1', sessionId: 'codex_a1', host: 'codex', status: 'open' });
  store.open({ key: 'c2', sessionId: 'codex_a1', host: 'codex', status: 'open' });

  assert.equal(store.listOpenBySession('codex_a1').length, 2);
  assert.deepEqual(
    store.listOpenBySession('codex_a1').map((card) => card.key).sort(),
    ['c1', 'c2'],
  );
});

test('card state store preserves existing options when update omits them', () => {
  const store = createCardStateStore();

  store.open({
    key: 'c1',
    sessionId: 'codex_a1',
    host: 'codex',
    status: 'open',
    options: [{ label: 'keep me' }],
  });

  const updated = store.update('c1', { status: 'closed' });

  assert.deepEqual(updated.options, [{ label: 'keep me' }]);
  assert.deepEqual(store.get('c1').options, [{ label: 'keep me' }]);
});

test('card state store keeps the map index aligned when update receives a different key', () => {
  const store = createCardStateStore();

  store.open({
    key: 'c1',
    sessionId: 'codex_a1',
    host: 'codex',
    status: 'open',
  });

  const updated = store.update('c1', { key: 'c2', status: 'closed' });

  assert.equal(updated.key, 'c1');
  assert.equal(store.get('c1').key, 'c1');
  assert.equal(store.get('c2'), null);
});

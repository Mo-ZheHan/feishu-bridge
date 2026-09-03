'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { SessionState } = require('../../src/lib/session-state');

test('setLastInteractedDevice 合并 __meta__，不抹掉「全局允许」终端表', () => {
  const p = path.join(os.tmpdir(), `ss-test-${process.pid}-${Date.now()}.json`);
  const st = new SessionState(p);
  st.load();
  st.data['__meta__'] = { autoApproveDevices: ['tmux:a'], updated_at: 1 };
  st.save();
  st.setLastInteractedDevice('tmux:b');
  const meta = new SessionState(p).load().data['__meta__'];
  assert.deepEqual(meta.autoApproveDevices, ['tmux:a']);
  assert.equal(meta.lastInteractedDevice, 'tmux:b');
  fs.unlinkSync(p);
});

test('addNotification 封顶 1000 条，最旧先淘汰，__meta__ 不计入', () => {
  const p = path.join(os.tmpdir(), `ss-test-${process.pid}-${Date.now()}-cap.json`);
  const st = new SessionState(p);
  st.load(); st.data['__meta__'] = { keep: true }; st.save();
  for (let i = 0; i < 1005; i++) st.addNotification(`k${i}`, { created_at: i });
  const data = new SessionState(p).load().data;
  assert.equal(Object.keys(data).length, 1001);            // 1000 条 + __meta__
  assert.ok(!data.k0 && !data.k4 && data.k5 && data.k1004 && data.__meta__.keep);
  fs.unlinkSync(p);
});

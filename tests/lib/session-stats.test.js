'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { fmtLeft, describeQuota, quotaColor, readOfficialStats } = require('../../src/lib/session-stats');

test('fmtLeft：分钟 → 2d 5h / 3h 1m / 45m，负数归零', () => {
  assert.equal(fmtLeft(45), '45m');
  assert.equal(fmtLeft(181), '3h 1m');
  assert.equal(fmtLeft(2 * 1440 + 5 * 60 + 59), '2d 5h');
  assert.equal(fmtLeft(-3), '0m');
});

test('describeQuota：秒与毫秒的 resetsAt 都认；已过重置点报「已重置」；无 pct 只给倒计时', () => {
  const now = 1_800_000_000_000;
  assert.deepEqual(describeQuota({ resetsAt: now / 1000 + 3600, pct: 12.6 }, now), { text: '1h 0m (13%)', pct: 13 });
  assert.deepEqual(describeQuota({ resetsAt: now + 90 * 60000, pct: 50 }, now), { text: '1h 30m (50%)', pct: 50 });
  assert.deepEqual(describeQuota({ resetsAt: now / 1000 - 1, pct: 99 }, now), { text: '已重置', pct: 0 });
  assert.deepEqual(describeQuota({ resetsAt: now / 1000 + 600 }, now), { text: '10m', pct: null });
  assert.equal(describeQuota(null, now), null);
  assert.equal(describeQuota({ pct: 3 }, now), null);
});

test('quotaColor：<50 中性灰、50–79 橙、≥80 红、未知中性灰', () => {
  assert.equal(quotaColor(49), 'neutral');
  assert.equal(quotaColor(50), 'orange');
  assert.equal(quotaColor(80), 'red');
  assert.equal(quotaColor(null), 'neutral');
});

test('readOfficialStats：按 sessionId 读 statsDir 下的文件，兼容 resets_at/used_percentage 原字段名；无文件 null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stats-'));
  fs.writeFileSync(path.join(dir, 'claude-cost-sid.json'), JSON.stringify({
    cost: 2.5, contextPct: 61, sessionName: 'n',
    fiveHour: { resetsAt: 1, pct: 10 }, sevenDay: { resets_at: 2, used_percentage: 20 },
  }));
  assert.deepEqual(readOfficialStats('sid', dir), {
    costUSD: 2.5, contextPct: 61, sessionName: 'n',
    fiveHour: { resetsAt: 1, pct: 10 }, sevenDay: { resetsAt: 2, pct: 20 },
  });
  fs.writeFileSync(path.join(dir, 'claude-cost-bare.json'), JSON.stringify({ cost: 0, fiveHour: null, sevenDay: { pct: 5 } }));
  assert.deepEqual(readOfficialStats('bare', dir), { costUSD: 0, contextPct: null, sessionName: undefined, fiveHour: null, sevenDay: null });
  assert.equal(readOfficialStats('missing', dir), null);
  assert.equal(readOfficialStats('', dir), null);
  fs.rmSync(dir, { recursive: true });
});

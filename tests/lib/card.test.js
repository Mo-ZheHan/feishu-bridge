'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { termLabel, footer, escFooterRow } = require('../../src/lib/card');

test('termLabel：本机 tmux 目标去前缀与默认窗格；容器目标去 =/@server；pts 去 /dev/', () => {
  assert.equal(termLabel('tmux:claude-x-120000:0.0'), 'claude-x-120000');
  assert.equal(termLabel('tmux:claude-x:1.2'), 'claude-x:1.2');
  assert.equal(termLabel('tmux:=claude-chat@workbench-app:/wb/run'), 'claude-chat');
  assert.equal(termLabel('/dev/ttys012'), 'ttys012');
  assert.equal(termLabel(null), '');
});

test('footer / escFooterRow：容器目标的灰字只显示会话名', () => {
  assert.equal(footer('claude', 'tmux:=claude-chat@workbench-app:/wb/run').content, "<font color='grey'>claude-chat</font>");
  const row = escFooterRow('k', 'tmux:=claude-chat@workbench-app:/wb/run');
  assert.equal(row.columns.length, 2);
  assert.equal(escFooterRow('k', null).columns.length, 1);
});

// ── header 标签：成本 / 上下文 / 5h / 7d 限额 ──
const { statsTags, statsSubtitle, card2 } = require('../../src/lib/card');

test('statsTags：三个标签 = 上下文 + 5h + 7d；限额写成「到重置 (已用%)」，过半橙、过八成红，缺数据不挂；不再有 ⏱ 时长', () => {
  const now = Date.now() / 1000;
  const stats = { costUSD: 1.234, contextPct: 42.4, sessionName: '样例', duration: '12m',
    fiveHour: { resetsAt: now + 3 * 3600 + 60, pct: 75 }, sevenDay: { resetsAt: now + 14 * 3600 + 31 * 60, pct: 44 } };
  assert.deepEqual(statsTags(stats), [
    { text: '🧠 42%', color: 'neutral' },
    { text: '⏳ 3h 1m (75%)', color: 'orange' },
    { text: '📅 14h 31m (44%)', color: 'neutral' },
  ]);
  assert.deepEqual(statsTags({ fiveHour: { resetsAt: now + 600, pct: 91 } }), [{ text: '⏳ 10m (91%)', color: 'red' }]);
  assert.deepEqual(statsTags({ fiveHour: { resetsAt: now - 5, pct: 91 } }), [{ text: '⏳ 已重置', color: 'neutral' }]);
  assert.deepEqual(statsTags({ costUSD: 0, contextPct: null, fiveHour: null }), []);
  assert.deepEqual(statsTags(null), []);
  // 成本进副标题，不占标签位
  assert.equal(statsSubtitle(stats), '样例 · $1.23');
  assert.equal(statsSubtitle({ costUSD: 0.5 }), '$0.50');
  assert.equal(statsSubtitle({ costUSD: 0, sessionName: '' }), undefined);
  assert.equal(statsSubtitle(null), undefined);
});

test('card2：header 标签封顶 3 个，缺省色 neutral', () => {
  const card = card2({ template: 'green', title: 't', tags: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }], elements: [] });
  assert.deepEqual(card.header.text_tag_list.map(t => t.text.content), ['a', 'b', 'c']);
  assert.equal(card.header.text_tag_list[0].color, 'neutral');
});

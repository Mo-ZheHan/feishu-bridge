'use strict';

/**
 * planTmuxKeys 单测：把按键串翻译成 tmux send-keys 分组。
 * 锁定 off-by-one 修复——方向键映射成原生键名、连发的重复键各自成组（不被重渲染 TUI 合并丢键）。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { planTmuxKeys } = require('../../src/lib/terminal-inject');

const DOWN = '\x1b[B', UP = '\x1b[A', RIGHT = '\x1b[C', LEFT = '\x1b[D';

test('方向键映射成 tmux 原生键名（不拆成 Escape/[/字母）', () => {
  assert.deepEqual(planTmuxKeys(DOWN), [{ named: true, keys: ['Down'] }]);
  assert.deepEqual(planTmuxKeys(UP + RIGHT + LEFT), [
    { named: true, keys: ['Up'] }, { named: true, keys: ['Right'] }, { named: true, keys: ['Left'] },
  ]);
});

test('连发的重复方向键各自成组（off-by-one 根因修复：不被合并丢键）', () => {
  assert.deepEqual(planTmuxKeys(DOWN.repeat(2)), [{ named: true, keys: ['Down'] }, { named: true, keys: ['Down'] }]);
  assert.deepEqual(planTmuxKeys(DOWN.repeat(3)).length, 3);
});

test('连续字面字符并作一批（长文本不退化成逐字、不丢键）', () => {
  assert.deepEqual(planTmuxKeys('居中好看'), [{ named: false, keys: ['居', '中', '好', '看'] }]);
});

test('预览备注键序 n→打字→Esc→Enter 切成正确分组', () => {
  assert.deepEqual(planTmuxKeys('n备注\x1b\r'), [
    { named: false, keys: ['n', '备', '注'] },
    { named: true, keys: ['Escape'] },
    { named: true, keys: ['Enter'] },
  ]);
});

test('文本+Enter 分两组（Enter 独立发，避免被当粘贴）；单个 Enter 一组', () => {
  assert.deepEqual(planTmuxKeys('hi\r'), [{ named: false, keys: ['h', 'i'] }, { named: true, keys: ['Enter'] }]);
  assert.deepEqual(planTmuxKeys('\r'), [{ named: true, keys: ['Enter'] }]);
});

test('C-u×3 三组；裸 Esc 一组；空串无组', () => {
  assert.deepEqual(planTmuxKeys('\x15\x15\x15'), [
    { named: true, keys: ['C-u'] }, { named: true, keys: ['C-u'] }, { named: true, keys: ['C-u'] },
  ]);
  assert.deepEqual(planTmuxKeys('\x1b'), [{ named: true, keys: ['Escape'] }]);
  assert.deepEqual(planTmuxKeys(''), []);
});

test('未知/不完整 CSI 安全回退成 Escape + 字面（不越界、不误吞）', () => {
  assert.deepEqual(planTmuxKeys('\x1b[H'), [{ named: true, keys: ['Escape'] }, { named: false, keys: ['[', 'H'] }]);
  assert.deepEqual(planTmuxKeys('\x1b['), [{ named: true, keys: ['Escape'] }, { named: false, keys: ['['] }]);
});

// ── 目标串解析：本机 tmux 与容器 tmux（经 docker exec） ──
const { parseTmuxTarget, tmuxSessionName } = require('../../src/lib/terminal-inject');

test('parseTmuxTarget：无 @ 即本机 tmux；带 @container:tmpdir 走 docker exec --user uid:gid；裸 =name 的窗格目标补冒号', () => {
  assert.deepEqual(parseTmuxTarget('claude-x:0.0'), { target: 'claude-x:0.0', pane: 'claude-x:0.0', argv: ['tmux'] });
  const r = parseTmuxTarget('=claude-chat@workbench-app:/wb/run');
  assert.equal(r.target, '=claude-chat');
  assert.equal(r.pane, '=claude-chat:'); // tmux 3.3a：send-keys -t =name 找不到窗格，=name: 才行
  assert.deepEqual(r.argv, ['docker', 'exec', '--user', `${process.getuid()}:${process.getgid()}`, 'workbench-app', 'env', 'TMUX_TMPDIR=/wb/run', 'tmux']);
  assert.equal(parseTmuxTarget('=s:1.1@c:/run').pane, '=s:1.1');
  assert.throws(() => parseTmuxTarget('x@'), /bad tmux target/);
  assert.throws(() => parseTmuxTarget('x@c'), /bad tmux target/);
  assert.throws(() => parseTmuxTarget('x@c:'), /bad tmux target/);
  assert.throws(() => parseTmuxTarget('@c:/run'), /bad tmux target/);
});

test('tmuxSessionName：去 =、去 :window.pane、去 @server，用作按会话落盘的文件名', () => {
  assert.equal(tmuxSessionName('=claude-chat@workbench-app:/wb/run'), 'claude-chat');
  assert.equal(tmuxSessionName('claude-x-120000:0.0'), 'claude-x-120000');
  assert.equal(tmuxSessionName('claude-x'), 'claude-x');
});

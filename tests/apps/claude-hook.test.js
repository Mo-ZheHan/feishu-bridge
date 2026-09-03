'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { handleStopFailure } = require('../../src/apps/claude-hook');

/** 把若干 transcript 行写到临时 jsonl，返回路径 */
function writeTranscript(lines) {
  const p = path.join(os.tmpdir(), `hook-test-${process.pid}-${lines.length}-${Math.floor(performance.now())}.jsonl`);
  fs.writeFileSync(p, lines.map(l => JSON.stringify(l)).join('\n'), 'utf8');
  return p;
}

/** transcript 末尾的一条 API 错误助手消息（与 Claude Code 真实结构对齐）。默认新鲜（刚刚发生） */
function apiErrorRow(text, error = 'unknown', timestamp = new Date().toISOString()) {
  return { type: 'assistant', isApiErrorMessage: true, error, timestamp, message: { role: 'assistant', content: [{ type: 'text', text }] } };
}

/** 取卡片正文里所有 markdown 文本拼起来，便于断言 */
function bodyText(card) {
  return card.body.elements.map(e => e.content || '').join('\n');
}

test('handleStopFailure：payload 不带 error_details 时反扫 transcript 取错误原文', () => {
  const tp = writeTranscript([
    { type: 'assistant', message: { content: [{ type: 'text', text: '正常输出' }] } },
    apiErrorRow('API Error: The socket connection was closed unexpectedly.'),
  ]);
  const card = handleStopFailure({ transcript_path: tp }, () => ({}));

  assert.equal(card.header.template, 'red');
  assert.equal(card.header.title.content, '异常退出');            // unknown 错误码 → 通用标题
  const body = bodyText(card);
  assert.match(body, /The socket connection was closed/);         // 正文为错误原文
  assert.doesNotMatch(body, /请求|req_|分支|多为|重试/);          // 不含 requestId / 自行推断的措辞
});

test('handleStopFailure：命中官方错误码时标题用官方映射，正文用 error_details', () => {
  const card = handleStopFailure({ error: 'rate_limit', error_details: '429 Too Many Requests' }, () => ({}));
  assert.equal(card.header.title.content, 'API 频率限制');
  assert.match(bodyText(card), /429 Too Many Requests/);
});

test('handleStopFailure：error_details 优先于 transcript 反扫', () => {
  const tp = writeTranscript([apiErrorRow('旧的 transcript 错误')]);
  const card = handleStopFailure({ transcript_path: tp, error_details: '更精确的 payload 错误' }, () => ({}));
  assert.match(bodyText(card), /更精确的 payload 错误/);
});

test('handleStopFailure：无任何错误信息时退化为「异常退出」+ 兜底文案', () => {
  const tp = writeTranscript([{ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }]);
  const card = handleStopFailure({ transcript_path: tp }, () => ({}));
  assert.equal(card.header.title.content, '异常退出');
  assert.match(bodyText(card), /发生未知错误/);
});

test('handleStopFailure：过期的历史 API 错误不采用，按错误码给兜底（修 529 串台旧限额消息）', () => {
  const stale = new Date(Date.now() - 9 * 3600e3).toISOString(); // 今早的限额消息，9 小时前
  const tp = writeTranscript([
    apiErrorRow("You've hit your session limit · resets 5:30am", 'rate_limit', stale),
    { type: 'assistant', message: { content: [{ type: 'text', text: '限额重置后又正常干了活' }] } },
  ]);
  const card = handleStopFailure({ error: 'server_error', transcript_path: tp }, () => ({}));
  assert.equal(card.header.title.content, '服务器错误');
  const body = bodyText(card);
  assert.match(body, /529|暂时/);                  // 用 server_error 的兜底文案
  assert.doesNotMatch(body, /session limit|限额/); // 绝不翻出 9 小时前的旧消息
});

test('handleStopFailure：新鲜的 transcript 错误（窗口内）照常采用原文', () => {
  const tp = writeTranscript([apiErrorRow('API Error: 529 Overloaded. try again', 'server_error')]);
  const card = handleStopFailure({ error: 'server_error', transcript_path: tp }, () => ({}));
  assert.match(bodyText(card), /529 Overloaded/);
});

// ── 问卷检测与会话登记 ──
const { extractAskUserQuestion, registerTmuxSession } = require('../../src/apps/claude-hook');

test('extractAskUserQuestion：只认最后一条 assistant 消息，前置文本进 _contextText', () => {
  const tp = writeTranscript([
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'AskUserQuestion', input: { questions: [{ question: '旧' }] } }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: '先说明' }, { type: 'tool_use', name: 'AskUserQuestion', input: { questions: [{ question: '新' }] } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] } },
  ]);
  const ask = extractAskUserQuestion(tp);
  assert.equal(ask.questions[0].question, '新');
  assert.equal(ask._contextText, '先说明');

  const tp2 = writeTranscript([
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'AskUserQuestion', input: { questions: [{ question: '旧' }] } }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: '最后一条不是问卷' }] } },
  ]);
  assert.equal(extractAskUserQuestion(tp2), null);
});

test('registerTmuxSession：按会话名落盘 transcript / 目标 / 统计目录；非 tmux 目标不写', () => {
  const name = `hooktest-${process.pid}-${Date.now()}`;
  const file = `/tmp/claude-tmux-${name}.json`;
  const prev = process.env.CLAUDE_STATS_DIR;
  process.env.CLAUDE_STATS_DIR = '/stats';
  registerTmuxSession(`tmux:=${name}@workbench-app:/wb/run`, { transcript_path: '/t.jsonl', session_id: 'sid' });
  if (prev === undefined) delete process.env.CLAUDE_STATS_DIR; else process.env.CLAUDE_STATS_DIR = prev;
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(j, { transcript: '/t.jsonl', target: `tmux:=${name}@workbench-app:/wb/run`, statsDir: '/stats', session_id: 'sid' });
  fs.unlinkSync(file);
  registerTmuxSession('/dev/ttys001', { transcript_path: '/t.jsonl' });
  assert.ok(!fs.existsSync('/tmp/claude-tmux-ttys001.json'));
});

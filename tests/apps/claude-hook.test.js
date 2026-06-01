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

/** transcript 末尾的一条 API 错误助手消息（与 Claude Code 真实结构对齐） */
function apiErrorRow(text, error = 'unknown') {
  return { type: 'assistant', isApiErrorMessage: true, error, message: { role: 'assistant', content: [{ type: 'text', text }] } };
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

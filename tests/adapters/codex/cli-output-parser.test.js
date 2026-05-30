const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseOutputBlock, parseExecutionSummary } = require('../../../src/adapters/codex/cli-output-parser');

const approvalFixture = fs.readFileSync(
  path.join(__dirname, '../../fixtures/codex/approval.txt'),
  'utf8'
);
const openQuestionFixture = fs.readFileSync(
  path.join(__dirname, '../../fixtures/codex/open-question.txt'),
  'utf8'
);

test('parser detects approval prompt from inline text', () => {
  const parsed = parseOutputBlock('Run npm test? (y/n)');

  assert.deepEqual(parsed, {
    kind: 'approval',
    confidence: 'high',
    question: 'Run npm test?',
    rawBlock: 'Run npm test? (y/n)',
  });
});

test('parser detects natural-language open question from inline text', () => {
  const parsed = parseOutputBlock('How would you like to proceed with the failing migration?');

  assert.deepEqual(parsed, {
    kind: 'open_question',
    confidence: 'medium',
    question: 'How would you like to proceed with the failing migration?',
    rawBlock: 'How would you like to proceed with the failing migration?',
  });
});

test('parser detects confirm prompt with explicit yes/no choices', () => {
  const parsed = parseOutputBlock('Continue deployment?\n1. Yes\n2. No');

  assert.deepEqual(parsed, {
    kind: 'confirm',
    confidence: 'high',
    question: 'Continue deployment?',
    options: [
      { label: 'Yes', value: '1' },
      { label: 'No', value: '2' },
    ],
    rawBlock: 'Continue deployment?\n1. Yes\n2. No',
  });
});

test('parser detects single-select prompt with numbered options', () => {
  const parsed = parseOutputBlock('Which environment should Codex use?\n1. staging\n2. production');

  assert.deepEqual(parsed, {
    kind: 'single_select',
    confidence: 'high',
    question: 'Which environment should Codex use?',
    options: [
      { label: 'staging', value: '1' },
      { label: 'production', value: '2' },
    ],
    rawBlock: 'Which environment should Codex use?\n1. staging\n2. production',
  });
});

test('parser detects multi-select prompt with checkbox options', () => {
  const parsed = parseOutputBlock('Select logs to include:\n[ ] stdout\n[ ] stderr\n[ ] trace');

  assert.deepEqual(parsed, {
    kind: 'multi_select',
    confidence: 'high',
    question: 'Select logs to include:',
    options: [
      { label: 'stdout', value: 'stdout' },
      { label: 'stderr', value: 'stderr' },
      { label: 'trace', value: 'trace' },
    ],
    allowFreeText: false,
    rawBlock: 'Select logs to include:\n[ ] stdout\n[ ] stderr\n[ ] trace',
  });
});

test('parser detects text input prompt from imperative prompt', () => {
  const parsed = parseOutputBlock('Enter a short label for this session:');

  assert.deepEqual(parsed, {
    kind: 'text_input',
    confidence: 'medium',
    question: 'Enter a short label for this session:',
    rawBlock: 'Enter a short label for this session:',
  });
});

test('parser detects single-select with letter-prefixed options (A./B./C.)', () => {
  const parsed = parseOutputBlock(
    'Which approach should we take?\nA. Refactor the module\nB. Add a wrapper\nC. Rewrite from scratch'
  );

  assert.equal(parsed.kind, 'single_select');
  assert.equal(parsed.confidence, 'high');
  assert.equal(parsed.question, 'Which approach should we take?');
  assert.deepEqual(parsed.options, [
    { label: 'Refactor the module', value: 'A' },
    { label: 'Add a wrapper', value: 'B' },
    { label: 'Rewrite from scratch', value: 'C' },
  ]);
});

test('parser detects confirm with letter-prefixed yes/no', () => {
  const parsed = parseOutputBlock('Continue?\nA. Yes\nB. No');

  assert.equal(parsed.kind, 'confirm');
  assert.equal(parsed.confidence, 'high');
  assert.deepEqual(parsed.options, [
    { label: 'Yes', value: 'A' },
    { label: 'No', value: 'B' },
  ]);
});

test('parser detects options with Chinese 、 delimiter', () => {
  const parsed = parseOutputBlock(
    '请选择方案:\n1、重构模块\n2、添加封装\n3、从头重写'
  );

  assert.equal(parsed.kind, 'single_select');
  assert.equal(parsed.options.length, 3);
  assert.equal(parsed.options[0].label, '重构模块');
  assert.equal(parsed.options[0].value, '1');
});

test('parser detects options with paren delimiter (A) B) C))', () => {
  const parsed = parseOutputBlock('Choose:\nA) Plan Alpha\nB) Plan Beta');

  assert.equal(parsed.kind, 'single_select');
  assert.deepEqual(parsed.options, [
    { label: 'Plan Alpha', value: 'A' },
    { label: 'Plan Beta', value: 'B' },
  ]);
});

test('parser returns none for non-interactive status output', () => {
  const parsed = parseOutputBlock('Updated 3 files in 120ms.');

  assert.deepEqual(parsed, {
    kind: 'none',
    confidence: 'low',
    rawBlock: 'Updated 3 files in 120ms.',
  });
});

test('parser detects approval prompt from fixture', () => {
  const parsed = parseOutputBlock(approvalFixture);

  assert.deepEqual(parsed, {
    kind: 'approval',
    confidence: 'high',
    question: 'Approve running npm test before continuing?',
    rawBlock: approvalFixture,
  });
});

test('parser detects natural-language open question from fixture', () => {
  const parsed = parseOutputBlock(openQuestionFixture);

  assert.deepEqual(parsed, {
    kind: 'open_question',
    confidence: 'medium',
    question: 'What should Codex do next with the partially applied migration?',
    rawBlock: openQuestionFixture,
  });
});

test('summary parser extracts execution summary, cwd, and token stats', () => {
  const parsed = parseExecutionSummary([
    'Execution complete.',
    'Current directory: /home/kamin/work/repo',
    'Input tokens: 1,234',
    'Output tokens: 56',
    'Total tokens: 1,290',
    'Updated 3 files in 120ms.',
  ].join('\n'));

  assert.deepEqual(parsed, {
    summary: 'Execution complete.\nUpdated 3 files in 120ms.',
    cwd: '/home/kamin/work/repo',
    tokens: {
      input: 1234,
      output: 56,
      total: 1290,
    },
  });
});

test('summary parser ignores spinner/noise-only terminal output', () => {
  const noisy = '\u001b[41;3H\u001b[?2026l\u001b]0;⠋ claude-notifier\u001b\\\u001b[?2026h';
  const parsed = parseExecutionSummary(noisy);
  assert.equal(parsed, null);
});

test('summary parser keeps unicode content and detects chinese completion text', () => {
  const parsed = parseExecutionSummary([
    '任务已完成。',
    '当前目录: /home/kamin/work/repo',
    '输入 tokens: 20',
    '输出 tokens: 8',
  ].join('\n'));

  assert.deepEqual(parsed, {
    summary: '任务已完成。',
    cwd: '/home/kamin/work/repo',
    tokens: {
      input: 20,
      output: 8,
      total: 28,
    },
  });
});

test('summary parser accepts plain assistant text without explicit token section', () => {
  const parsed = parseExecutionSummary('Hi! I can help you with that.');
  assert.deepEqual(parsed, {
    summary: 'Hi! I can help you with that.',
    cwd: null,
    tokens: {},
  });
});

test('summary parser removes orphan ANSI fragments without ESC prefix', () => {
  const parsed = parseExecutionSummary([
    '[48;2;57;57;57m7',
    '执行中：正在整理通知逻辑',
    '[0m',
    '当前目录: /home/kamin/work/repo',
    '输入 tokens: 20',
    '输出 tokens: 8',
  ].join('\n'));

  assert.deepEqual(parsed, {
    summary: '执行中：正在整理通知逻辑',
    cwd: '/home/kamin/work/repo',
    tokens: {
      input: 20,
      output: 8,
      total: 28,
    },
  });
});

test('summary parser keeps long multi-line summary without truncating to last 6 lines', () => {
  const parsed = parseExecutionSummary([
    '第1行',
    '第2行',
    '第3行',
    '第4行',
    '第5行',
    '第6行',
    '第7行',
    '第8行',
    '当前目录: /home/kamin/work/repo',
    '输入 tokens: 20',
    '输出 tokens: 8',
  ].join('\n'));

  assert.deepEqual(parsed, {
    summary: '第1行\n第2行\n第3行\n第4行\n第5行\n第6行\n第7行\n第8行',
    cwd: '/home/kamin/work/repo',
    tokens: {
      input: 20,
      output: 8,
      total: 28,
    },
  });
});

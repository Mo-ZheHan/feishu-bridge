'use strict';

/**
 * 窗口式倒序读：transcript 会长到几百 MB，读取必须只碰尾部；且跨窗口边界的行只交付一次、不漏、不重。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { forEachTailLine, forEachTail, findTail, currentTurn } = require('../../src/lib/transcript-utils');

function tmpFile(content) {
  const p = path.join(os.tmpdir(), `tu-test-${process.pid}-${Math.floor(performance.now() * 1000)}.jsonl`);
  fs.writeFileSync(p, content);
  return p;
}

/** n 条记录，长度参差、含多字节字符，总量远超首个 256 KB 窗口，逼出多次扩窗 */
function bigTranscript(n) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const pad = '中文填充'.repeat((i * 37) % 900); // 0 ~ 10 KB 的行
    rows.push({ i, type: i % 50 === 0 ? 'user' : 'assistant', timestamp: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}Z`, pad,
      message: i % 50 === 0 ? { content: `prompt ${i}` } : { content: [{ type: 'text', text: `t${i}` }] } });
  }
  return rows;
}

test('forEachTailLine：跨多个窗口倒序交付每一行，恰好一次', () => {
  const rows = bigTranscript(600);
  const p = tmpFile(rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  assert.ok(fs.statSync(p).size > 1024 * 1024, '样本应超过 1 MB，覆盖至少三次扩窗');
  const seen = [];
  forEachTailLine(p, (line) => { seen.push(JSON.parse(line).i); return false; });
  assert.deepEqual(seen, rows.map(r => r.i).reverse());
  fs.unlinkSync(p);
});

test('forEachTailLine：无尾换行的文件与单行大于首窗的文件都完整交付', () => {
  const rows = bigTranscript(5);
  rows[2].pad = 'x'.repeat(300 * 1024); // 单行 300 KB > 256 KB 首窗
  const p = tmpFile(rows.map(r => JSON.stringify(r)).join('\n')); // 无尾换行
  const seen = [];
  forEachTailLine(p, (line) => { seen.push(JSON.parse(line).i); return false; });
  assert.deepEqual(seen, [4, 3, 2, 1, 0]);
  fs.unlinkSync(p);
});

test('forEachTail / findTail：返 true 即止，只读到需要的位置', () => {
  const rows = bigTranscript(300);
  const p = tmpFile(rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  let visited = 0;
  forEachTail(p, (d) => { visited++; return d.type === 'user'; });
  assert.equal(visited, 300 - 250, '最后一条 user 在 i=250，之后有 49 条 + 自身');
  assert.equal(findTail(p, d => d.type === 'user' ? d.i : undefined), 250);
  assert.equal(findTail(p, () => undefined), undefined);
  fs.unlinkSync(p);
});

test('currentTurn：上一条 user prompt 之后的记录按文件顺序返回，并给出边界记录', () => {
  const rows = bigTranscript(120);
  const p = tmpFile(rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const { boundary, records } = currentTurn(p);
  assert.equal(boundary.i, 100);
  assert.deepEqual(records.map(r => r.i), rows.slice(101).map(r => r.i));
  fs.unlinkSync(p);
});

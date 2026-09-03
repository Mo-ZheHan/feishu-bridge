'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const launcher = require('../../src/apps/launcher');

test('sessionName / sessionTarget：与 ccc 的 wb_session_name 同规则，非字母数字连字符 → -', () => {
  assert.equal(launcher.sessionName('lingbot-va', 'tx_248'), 'claude-tx-248-lingbot-va');
  assert.equal(launcher.sessionName('my.proj'), 'claude-my-proj');
  assert.equal(launcher.sessionTarget('claude-tx-248-lingbot-va'), 'tmux:=claude-tx-248-lingbot-va@workbench-app:/wb/run');
});

test('parseLaunchCommand：ccback / 本地 / 远程 / 透传 --resume / 未知主机 / 忽略', () => {
  const hosts = ['tx_248', 'fitten8'];
  const p = (t) => launcher.parseLaunchCommand(t, hosts);
  assert.deepEqual(p('ccc back'), { kind: 'ccback' });                 // 接回是 `ccc back`（与 ccc 本体一致）
  assert.deepEqual(p('ccback'), { kind: 'ignore' });                  // 旧的单词 ccback 不再认
  assert.deepEqual(p('ccc'), { kind: 'launch', host: null, passArgs: [] });
  assert.deepEqual(p('ccc --resume'), { kind: 'launch', host: null, passArgs: ['--resume'] });
  assert.deepEqual(p('ccc tx_248 --resume'), { kind: 'launch', host: 'tx_248', passArgs: ['--resume'] });
  assert.deepEqual(p('claude fitten8'), { kind: 'ignore' });          // claude 别名已移除
  assert.deepEqual(p('ccc nope'), { kind: 'unknown_host', host: 'nope' });
  assert.deepEqual(p('  @_user_1 ccc   tx_248  '), { kind: 'launch', host: 'tx_248', passArgs: [] }); // 去 @提及 + 多空格
  assert.deepEqual(p('ccc back tx_248'), { kind: 'ccback' });          // back 优先，后续忽略
  assert.deepEqual(p('随便聊聊'), { kind: 'ignore' });
  assert.deepEqual(p(''), { kind: 'ignore' });
});

test('readHostsConfig：从 hosts.sh source 出主机表、项目根、按主机覆盖（含续行）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hosts-'));
  const cfg = path.join(dir, 'hosts.sh');
  fs.writeFileSync(cfg, [
    'WB_REMOTE_HOSTS="tx_248 fitten8 \\',
    'cscg200 B200"',
    "WB_REMOTE_BASE='~/Code'",
    'WB_REMOTE_BASE_OVERRIDE="B200=/dockerdata tx_248=/root/projects/mzh"',
  ].join('\n'));
  const out = launcher.readHostsConfig(cfg);
  assert.deepEqual(out.hosts, ['tx_248', 'fitten8', 'cscg200', 'B200']);
  assert.equal(out.base, '~/Code');
  assert.deepEqual(out.overrides, { B200: '/dockerdata', tx_248: '/root/projects/mzh' });
  assert.deepEqual(launcher.readHostsConfig(path.join(dir, 'missing.sh')), { hosts: [], base: '~/Code', overrides: {} });
  fs.rmSync(dir, { recursive: true });
});

test('launchLocal / listRemoteProjects：非法项目名与未知主机被拦，不 spawn', () => {
  assert.deepEqual(launcher.launchLocal('../etc'), { error: '非法项目名: ../etc' });
  assert.match(launcher.launchLocal('definitely-not-a-real-project-xyz').error || '', /目录不存在/);
  assert.match(launcher.listRemoteProjects('no-such-host').error, /未知主机/);
  assert.deepEqual(launcher.launchRemote('no-such-host', 'p'), { error: '非法主机或项目: no-such-host p' });
});

test('projectSlug：容器 cwd 的非字母数字字符（含下划线/斜杠）→ -；远程走 /home/<host>/<proj>', () => {
  assert.equal(launcher.projectSlug('EmbodiedHub', 'tx_248'), '-home-tx-248-EmbodiedHub');
  assert.match(launcher.projectSlug('my.proj'), /-Users-.*-my-proj$/); // 本地含 ~/Code 前缀
});

test('listResumableSessions：读 projects/<slug>/*.jsonl，按 mtime 倒序，取首条 user/ summary 作标签', () => {
  const os = require('node:os'), fs = require('node:fs'), path = require('node:path');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-home-'));
  const dir = path.join(home, 'projects', '-home-h-proj');
  fs.mkdirSync(dir, { recursive: true });
  const write = (id, rows, mtime) => {
    const f = path.join(dir, id + '.jsonl');
    fs.writeFileSync(f, rows.map(r => JSON.stringify(r)).join('\n'));
    fs.utimesSync(f, new Date(mtime), new Date(mtime));
  };
  write('aaaa', [{ type: 'user', message: { content: '第一个问题' } }], Date.now() - 3600e3);
  write('bbbb', [{ type: 'summary', summary: '给会话加自定义' }, { type: 'user', message: { content: 'x' } }], Date.now() - 60e3);
  fs.writeFileSync(path.join(dir, 'notjsonl.txt'), 'ignore me');

  const prev = process.env.WB_HOST_CLAUDE_HOME;
  process.env.WB_HOST_CLAUDE_HOME = home;
  delete require.cache[require.resolve('../../src/apps/launcher')];
  const fresh = require('../../src/apps/launcher');
  const out = fresh.listResumableSessions('proj', 'h');
  if (prev === undefined) delete process.env.WB_HOST_CLAUDE_HOME; else process.env.WB_HOST_CLAUDE_HOME = prev;
  delete require.cache[require.resolve('../../src/apps/launcher')];

  assert.deepEqual(out.map(s => s.id), ['bbbb', 'aaaa']);        // mtime 倒序
  assert.equal(out[0].summary, '给会话加自定义');                  // summary 优先
  assert.equal(out[1].summary, '第一个问题');                      // 无 summary → 首条 user
  assert.deepEqual(fresh.listResumableSessions('nope', 'h'), []); // 无目录 → 空
  fs.rmSync(home, { recursive: true });
});

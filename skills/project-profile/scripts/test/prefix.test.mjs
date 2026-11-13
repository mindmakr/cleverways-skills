import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, existsSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { draft, report, userSkills } from '../prefix.mjs';

const script = fileURLToPath(new URL('../prefix.mjs', import.meta.url));
const json = (file, obj) => {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify(obj));
};

// A fake home and a git project. Skills: alpha, beta (folders), linked (a symlink to a folder).
function setup() {
  const base = mkdtempSync(join(tmpdir(), 'prefix-test-'));
  const home = join(base, 'home');
  const project = join(base, 'proj');
  const skills = join(home, '.claude', 'skills');
  for (const n of ['alpha', 'beta', '.hidden', 'synced', 'real']) {
    mkdirSync(join(skills, n), { recursive: true });
    writeFileSync(join(skills, n, 'SKILL.md'), `---\nname: ${n}\ndescription: Use when ${n}.\n---\n`);
  }
  writeFileSync(join(skills, 'file.txt'), 'not a skill');
  try {
    symlinkSync(join(skills, 'real'), join(skills, 'linked'), 'junction');
  } catch {
    // links are not allowed on this machine; the link assertion is relaxed below
  }
  json(join(home, '.claude', 'settings.json'), {
    enabledPlugins: { 'cleverways@cleverways': true, 'ecc@ecc': true, 'tool@m': true, 'off@m': false },
  });
  json(join(home, '.claude.json'), { mcpServers: { userSrv: {} } });
  mkdirSync(project, { recursive: true });
  spawnSync('git', ['init', '-q', project]);
  json(join(project, '.mcp.json'), { mcpServers: { projSrv: {} } });
  return { home, project };
}
const run = (home, project, ...args) =>
  spawnSync(process.execPath, [script, ...args, '--home', home, '--project', project], { encoding: 'utf8' });

test('user skills follow links and skip dot folders, synced and files', () => {
  const { home } = setup();
  const names = userSkills(home).map((s) => s.name);
  assert.ok(names.includes('alpha') && names.includes('beta') && names.includes('real'));
  assert.ok(!names.includes('.hidden') && !names.includes('synced') && !names.includes('file.txt'));
  if (existsSync(join(home, '.claude', 'skills', 'linked'))) assert.ok(names.includes('linked'));
  assert.equal(userSkills(home).find((s) => s.name === 'alpha').chars, 'Use when alpha.'.length);
});

test('report counts enabled plugins, skills and MCP servers from every source', () => {
  const { home, project } = setup();
  const r = report(project, home);
  assert.equal(r.plugins.enabled, 3);
  assert.deepEqual(r.plugins.keep, ['cleverways@cleverways']);
  assert.deepEqual(r.plugins.off.sort(), ['ecc@ecc', 'tool@m']);
  assert.deepEqual(r.mcpServers.names.map((s) => s.name).sort(), ['projSrv', 'userSrv']);
  assert.ok(r.skills.count >= 3);
  assert.equal(r.trimmed, false);
});

test('draft keeps the project plugins and --keep names, and turns the rest off', () => {
  const { home, project } = setup();
  json(join(project, '.claude', 'settings.json'), { enabledPlugins: { 'tool@m': true } });
  const d = draft(project, home, { keep: ['alpha'] });
  assert.deepEqual(d.enabledPlugins, { 'ecc@ecc': false });
  assert.equal(d.skillOverrides.alpha, undefined);
  assert.equal(d.skillOverrides.beta, 'off');
  assert.equal(d.syncClaudeAiSkills, undefined);
  assert.equal(draft(project, home, { syncOff: true }).disableClaudeAiConnectors, true);
});

test('draft merges into the existing local file and drops no key', () => {
  const { home, project } = setup();
  json(join(project, '.claude', 'settings.local.json'), {
    permissions: { allow: ['Bash(ls)'] },
    enabledPlugins: { 'mine@m': false, 'tool@m': true },
    skillOverrides: { beta: 'name-only' },
  });
  const d = draft(project, home);
  assert.deepEqual(d.permissions, { allow: ['Bash(ls)'] });
  assert.equal(d.enabledPlugins['mine@m'], false);
  assert.equal(d.enabledPlugins['tool@m'], true);
  assert.equal(d.enabledPlugins['ecc@ecc'], false);
  assert.equal(d.skillOverrides.beta, 'name-only');
  assert.equal(d.skillOverrides.alpha, 'off');
});

test('draft writes nothing and never touches the user-level file', () => {
  const { home, project } = setup();
  const userFile = join(home, '.claude', 'settings.json');
  const before = readFileSync(userFile, 'utf8');
  const r = run(home, project, 'draft');
  assert.equal(r.status, 0);
  assert.ok(JSON.parse(r.stdout).enabledPlugins['ecc@ecc'] === false);
  assert.equal(existsSync(join(project, '.claude', 'settings.local.json')), false);
  assert.equal(readFileSync(userFile, 'utf8'), before);
});

test('write refuses without --confirm', () => {
  const { home, project } = setup();
  const r = run(home, project, 'write');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--confirm/);
  assert.equal(existsSync(join(project, '.claude', 'settings.local.json')), false);
});

test('write with --confirm saves the file, excludes it from git, and a second run adds no duplicate', () => {
  const { home, project } = setup();
  const userFile = join(home, '.claude', 'settings.json');
  const before = readFileSync(userFile, 'utf8');
  assert.equal(run(home, project, 'write', '--confirm').status, 0);
  assert.equal(run(home, project, 'write', '--confirm').status, 0);
  const saved = JSON.parse(readFileSync(join(project, '.claude', 'settings.local.json'), 'utf8'));
  assert.equal(saved.enabledPlugins['ecc@ecc'], false);
  assert.equal(saved.enabledPlugins['cleverways@cleverways'], undefined);
  const exclude = readFileSync(join(project, '.git', 'info', 'exclude'), 'utf8');
  assert.equal(exclude.split('\n').filter((l) => l === '.claude/settings.local.json').length, 1);
  assert.equal(readFileSync(userFile, 'utf8'), before);
  const status = spawnSync('git', ['-C', project, 'status', '--porcelain'], { encoding: 'utf8' }).stdout;
  assert.ok(!status.includes('settings.local.json'));
});

test('an unknown argument exits 2', () => {
  const { home, project } = setup();
  assert.equal(run(home, project, 'report', '--nope').status, 2);
});

test('a local file that does not parse stops draft, write and report, and is left as it was', () => {
  for (const [name, bad] of [
    ['trailing comma', '{"permissions":{"allow":["Bash(ls)"]},}'],
    ['an array', '[1]'],
    ['null', 'null'],
  ]) {
    const { home, project } = setup();
    const file = join(project, '.claude', 'settings.local.json');
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, bad);
    for (const args of [['draft'], ['write', '--confirm'], ['report']]) {
      const r = run(home, project, ...args);
      assert.equal(r.status, 1, `${name} ${args[0]}`);
      assert.match(r.stderr, /settings\.local\.json is not/, `${name} ${args[0]}`);
      assert.equal(r.stdout, '', `${name} ${args[0]}`);
    }
    assert.equal(readFileSync(file, 'utf8'), bad, name);
    assert.throws(() => draft(project, home), /settings\.local\.json is not/);
  }
});

test('an empty local file and a file with a byte order mark are read', () => {
  const { home, project } = setup();
  const file = join(project, '.claude', 'settings.local.json');
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, '  \n');
  assert.equal(run(home, project, 'draft').status, 0);
  writeFileSync(file, '\uFEFF{"permissions":{"allow":["Bash(ls)"]}}');
  assert.deepEqual(draft(project, home).permissions, { allow: ['Bash(ls)'] });
});

test('write in a subfolder of a git repo excludes the path under the repo root', () => {
  const { home } = setup();
  const repo = mkdtempSync(join(tmpdir(), 'prefix-sub-'));
  spawnSync('git', ['init', '-q', repo]);
  const project = join(repo, 'sub');
  mkdirSync(project, { recursive: true });
  const r = run(home, project, 'write', '--confirm');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(project, '.claude', 'settings.local.json')));
  const exclude = readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8');
  assert.equal(exclude.split('\n').filter((l) => l === 'sub/.claude/settings.local.json').length, 1);
  assert.equal(run(home, project, 'write', '--confirm').status, 0);
  const again = readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8');
  assert.equal(again.split('\n').filter((l) => l === 'sub/.claude/settings.local.json').length, 1);
  const status = spawnSync('git', ['-C', repo, 'status', '--porcelain', '-uall'], { encoding: 'utf8' }).stdout;
  assert.ok(!status.includes('settings.local.json'), status);
});

test('--project or --home with no value prints the usage line and exits 2', () => {
  for (const flag of ['--project', '--home']) {
    const r = spawnSync(process.execPath, [script, 'report', flag], { encoding: 'utf8' });
    assert.equal(r.status, 2, flag);
    assert.match(r.stderr, /^usage:/, flag);
    assert.ok(!r.stderr.includes('at '), flag);
  }
});

test('an enabledPlugins or skillOverrides that is not an object stops with an error and writes nothing', () => {
  for (const key of ['enabledPlugins', 'skillOverrides']) {
    for (const bad of [['x'], 'text', null, 3]) {
      const { home, project } = setup();
      const file = join(project, '.claude', 'settings.local.json');
      const text = JSON.stringify({ [key]: bad });
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, text);
      for (const args of [['draft'], ['write', '--confirm'], ['report']]) {
        const r = run(home, project, ...args);
        assert.equal(r.status, 1, `${key} ${text} ${args[0]}`);
        assert.match(r.stderr, new RegExp(`${key} is not a JSON object`));
        assert.equal(r.stdout, '');
      }
      assert.equal(readFileSync(file, 'utf8'), text);
    }
  }
});

test('report says trimmed only when the local file turns plugins or skills off', () => {
  const { home, project } = setup();
  const file = join(project, '.claude', 'settings.local.json');
  json(file, { permissions: { allow: ['Bash(ls)'] } });
  assert.equal(report(project, home).trimmed, false);
  json(file, { enabledPlugins: {} });
  assert.equal(report(project, home).trimmed, false);
  json(file, { enabledPlugins: { 'ecc@ecc': false } });
  assert.equal(report(project, home).trimmed, true);
  json(file, { skillOverrides: { beta: 'off' } });
  assert.equal(report(project, home).trimmed, true);
});

test('descriptions written as YAML block scalars count the text', () => {
  const { home } = setup();
  const skills = join(home, '.claude', 'skills');
  const put = (name, fm) => {
    mkdirSync(join(skills, name), { recursive: true });
    writeFileSync(join(skills, name, 'SKILL.md'), `---\nname: ${name}\n${fm}\n---\nbody\n`);
  };
  put('folded', 'description: >\n  Use when one.\n  Then two.\nother: x');
  put('literal', 'description: |-\n  Use when one.\n  Then two.');
  put('crlf', 'description: >\n  Use when one.'.replace(/\n/g, '\r\n'));
  const chars = (n) => userSkills(home).find((s) => s.name === n).chars;
  assert.equal(chars('folded'), 'Use when one. Then two.'.length);
  assert.equal(chars('literal'), 'Use when one.\nThen two.'.length);
  assert.equal(chars('crlf'), 'Use when one.'.length);
});

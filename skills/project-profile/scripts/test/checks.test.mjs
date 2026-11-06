import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { failures, parseCommands, splitEnv } from '../checks.mjs';

const script = fileURLToPath(new URL('../checks.mjs', import.meta.url));

// A repo with a profile whose Commands rows are given as [purpose, commandCell, runFromCell].
function repo(rows) {
  const root = mkdtempSync(join(tmpdir(), 'checks-test-'));
  mkdirSync(join(root, '.agents'));
  mkdirSync(join(root, 'a'));
  mkdirSync(join(root, 'b'));
  const table = rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
  writeFileSync(join(root, '.agents', 'project-profile.md'),
    `# Profile\n\n## Commands\n\n| Purpose | Command | Run from |\n|---|---|---|\n${table}\n\n- Checks: local\n\n## Local run\n\n| x | y |\n`);
  return root;
}
const run = (root, ...args) => {
  const r = spawnSync(process.execPath, [script, '--root', root, ...args], { encoding: 'utf8' });
  return { code: r.status, lines: r.stdout.trim().split('\n').filter(Boolean), stderr: r.stderr };
};
const node = (js) => `\`node -e "${js}"\``;

test('parses the Commands table, skipping prose rows and stopping at the next section', () => {
  const rows = parseCommands(readFileSync(join(repo([
    ['Typecheck', '`npx tsc --noEmit`', '`backend/`, `frontend/`'],
    ['Pipe', '`npm test | tee out`', 'repo root'],
    ['Translation check', 'managing-translations skill on `frontend/messages`', 'repo root'],
  ]), '.agents', 'project-profile.md'), 'utf8'));
  assert.deepEqual(rows, [
    { purpose: 'Typecheck', command: 'npx tsc --noEmit', dirs: ['backend/', 'frontend/'] },
    { purpose: 'Pipe', command: 'npm test | tee out', dirs: [] },
    { purpose: 'Translation check', command: null, dirs: [] },
  ]);
});

test('splits leading env assignments off the command', () => {
  assert.deepEqual(splitEnv('RUN_DB_TESTS=1 npx vitest run'), { env: { RUN_DB_TESTS: '1' }, command: 'npx vitest run' });
  assert.deepEqual(splitEnv('A=1 B="x y" npm test'), { env: { A: '1', B: 'x y' }, command: 'npm test' });
  assert.deepEqual(splitEnv('npm test -- --grep=a'), { env: {}, command: 'npm test -- --grep=a' });
});

test('one line per command and directory, PASS and exit 0 when all pass', () => {
  const root = repo([['Typecheck', node('process.exit(0)'), '`a/`, `b/`'], ['Lint', node('console.log(1)'), '']]);
  const r = run(root);
  assert.equal(r.code, 0);
  assert.equal(r.lines.length, 3);
  assert.match(r.lines[0], /^PASS Typecheck \[a\/\] \(\d+\.\d+s\)$/);
  assert.match(r.lines[1], /^PASS Typecheck \[b\/\] \(\d+\.\d+s\)$/);
  assert.match(r.lines[2], /^PASS Lint \[\.\] \(\d+\.\d+s\)$/);
});

test('runs each command in its directory', () => {
  const root = repo([['Where', node("require('fs').statSync('marker') || process.exit(1)"), '`a/`']]);
  writeFileSync(join(root, 'a', 'marker'), '');
  assert.equal(run(root).code, 0);
});

test('--only matches purpose words, case-insensitive, comma separated', () => {
  const root = repo([['Typecheck', node('0'), ''], ['Unit tests', node('0'), ''], ['Lint', node('0'), '']]);
  const r = run(root, '--only', 'TYPE, unit');
  assert.deepEqual(r.lines.map((l) => l.split(' ')[1]), ['Typecheck', 'Unit']);
  assert.equal(run(root, '--only', 'nothing').code, 1);
});

test('prints SKIP for a row that is not a command', () => {
  const root = repo([['Translation check', 'managing-translations skill on `x`', 'repo root']]);
  const r = run(root);
  assert.deepEqual(r.lines, ['SKIP Translation check (not a command)']);
  assert.equal(r.code, 0);
});

test('a failure lists the failing test names and the log, and exits 1; the log holds the full output', () => {
  const out = 'console.log(\'not ok 1 - adds numbers\\nnot ok 2 - rounds halala\\nok 3 - fine\'); process.exit(1)';
  const root = repo([['Unit tests', node(out), '`a/`'], ['Lint', node('0'), '']]);
  const r = run(root);
  assert.equal(r.code, 1);
  assert.equal(r.lines.length, 2);
  const m = r.lines[0].match(/^FAIL Unit tests \[a\/\] \(\d+\.\d+s\): adds numbers; rounds halala log: (.+)$/);
  assert.ok(m, r.lines[0]);
  assert.match(readFileSync(m[1], 'utf8'), /ok 3 - fine/);
  assert.match(r.lines[1], /^PASS Lint/);
});

test('leading env assignments reach the command on every platform', () => {
  const root = repo([['Integration tests', '`RUN_DB_TESTS=1 GREETING="hi there" node -e "process.exit(process.env.RUN_DB_TESTS === \'1\' && process.env.GREETING === \'hi there\' ? 0 : 1)"`', '']]);
  const r = run(root);
  assert.equal(r.code, 0, r.lines.join('\n'));
});

test('--cmd runs one command quietly in --dir', () => {
  const root = repo([]);
  writeFileSync(join(root, 'b', 'marker'), '');
  const r = run(root, '--cmd', `node -e "require('fs').statSync('marker')"`, '--dir', 'b');
  assert.equal(r.code, 0);
  assert.match(r.lines[0], /^PASS node -e .* \[b\] \(\d+\.\d+s\)$/);
});

test('a missing directory fails with the reason', () => {
  const r = run(repo([['Lint', node('0'), '`nope/`']]));
  assert.equal(r.code, 1);
  assert.match(r.lines[0], /^FAIL Lint \[nope\/\] .*directory not found/);
});

test('extracts vitest failures without repeating the short name', () => {
  const text = [
    ' ❯ src/fee.test.ts (3 tests | 2 failed) 12ms',
    '   × fee > rounds up per started 1,000 5ms',
    '   × fee > adds VAT 2ms',
    '   ✓ fee > zero 1ms',
    ' FAIL  src/fee.test.ts > fee > rounds up per started 1,000',
    ' FAIL  src/fee.test.ts > fee > adds VAT',
    ' Test Files  1 failed (1)',
  ].join('\n');
  assert.deepEqual(failures(text), ['src/fee.test.ts > fee > rounds up per started 1,000', 'src/fee.test.ts > fee > adds VAT']);
});

test('extracts jest failures', () => {
  const text = ['FAIL src/a.test.js', '  sum', '    ✕ adds (3 ms)', '    ✓ subtracts (1 ms)', '  ● sum › adds', '  ● Console'].join('\n');
  assert.deepEqual(failures(text), ['src/a.test.js', 'sum › adds']);
});

test('extracts node:test spec failures once', () => {
  const text = ['✔ ok one (1.1ms)', '✖ breaks two (2.3ms)', 'ℹ fail 1', '✖ failing tests:', '', 'test at a.test.mjs:3:1', '✖ breaks two (2.3ms)'].join('\n');
  assert.deepEqual(failures(text), ['breaks two']);
});

test('extracts tsc errors', () => {
  const text = ['src/a.ts(3,7): error TS2322: Type \'string\' is not assignable to type \'number\'.', 'src/b.ts:9:1 - error TS2304: Cannot find name \'x\'.', 'Found 2 errors.'].join('\n');
  assert.deepEqual(failures(text), [
    'src/a.ts(3,7): error TS2322: Type \'string\' is not assignable to type \'number\'.',
    'src/b.ts:9:1 - error TS2304: Cannot find name \'x\'.',
  ]);
});

test('extracts eslint errors with their file, and skips warnings', () => {
  const text = ['', 'D:\\repo\\src\\app\\page.tsx', '  4:10  error    \'x\' is defined but never used  no-unused-vars', '  9:1   warning  Unexpected console  no-console', '', '✖ 2 problems (1 error, 1 warning)'].join('\n');
  assert.deepEqual(failures(text), ['app/page.tsx:4:10 \'x\' is defined but never used no-unused-vars']);
});

test('falls back to error lines, then the last lines, and caps at ten', () => {
  assert.deepEqual(failures('starting\nnpm ERR! missing script: lint\nnpm error code 1\n'), ['npm ERR! missing script: lint', 'npm error code 1']);
  assert.deepEqual(failures('a\nb\nc\nd\n'), ['b', 'c', 'd']);
  const many = Array.from({ length: 15 }, (_, i) => `not ok ${i + 1} - t${i}`).join('\n');
  assert.equal(failures(many).length, 10);
});

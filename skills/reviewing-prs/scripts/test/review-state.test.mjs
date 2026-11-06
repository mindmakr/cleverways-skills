import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../review-state.mjs', import.meta.url));
const stateFile = (state) => {
  const file = join(mkdtempSync(join(tmpdir(), 'review-state-')), 'state.json');
  writeFileSync(file, JSON.stringify(state));
  return file;
};
const run = (args, cwd) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd });
const render = (state) => execFileSync(process.execPath, [script, 'put', '1', '--repo', 'o/r', '--file', stateFile(state), '--dry'], { encoding: 'utf8' });
const base = { pr: 1, round: 2, reviewedSha: 'abc1234def', issues: [7], verdict: 'READY TO MERGE', blockedOn: null, findings: [], questions: [] };

test('the tracker shows a local check run by the reviewer on the reviewed head', () => {
  const out = render({ ...base, checks: { where: 'local', command: 'pnpm check', sha: 'abc1234def', result: 'passed: 48 tests, 0 failed' } });
  assert.match(out, /Checks \(local\): `pnpm check` on `abc1234`: passed: 48 tests, 0 failed/);
});

test('the tracker shows no checks line when the state has none', () => {
  assert.doesNotMatch(render(base), /Checks/);
});

// A throwaway repo: main has one file, the PR branch adds a plain file, then a fix touches a route.
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'review-scope-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
  const put = (path, text) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); };
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  put('README.md', 'x\n'); g('add', '.'); g('commit', '-qm', 'base');
  const mainSha = g('rev-parse', 'HEAD');
  g('checkout', '-qb', 'pr');
  put('src/services/report.ts', 'a\n'); g('add', '.'); g('commit', '-qm', 'r1');
  const r1 = g('rev-parse', 'HEAD');
  put('src/services/report.ts', 'b\n'); g('add', '.'); g('commit', '-qm', 'plain fix');
  const plain = g('rev-parse', 'HEAD');
  put('src/routes/auth/login.ts', 'c\n'); g('add', '.'); g('commit', '-qm', 'route fix');
  const route = g('rev-parse', 'HEAD');
  return { dir, mainSha, r1, plain, route };
}
const scope = (r, state, head, extra = []) => {
  const res = run(['scope', '1', '--repo', 'o/r', '--state', stateFile(state), '--base', 'main', '--head', head, ...extra], r.dir);
  return { ...res, out: res.status === 0 ? JSON.parse(res.stdout) : null };
};
const fresh = { ...base, round: 0, reviewedSha: null, verdict: null };

test('round 1 reviews the whole PR with the code-review skill on the PR, and security', () => {
  const r = repo();
  const { out } = scope(r, fresh, r.r1);
  assert.equal(out.mode, 'full');
  assert.equal(out.security, true);
  assert.equal(out.range, `${r.mainSha}..${r.r1}`);
  assert.equal(out.correctness, 'code-review high 1');
});

test('a follow-up round reviews only the new range, by subagent, without security when no relevant path changed', () => {
  const r = repo();
  const { out } = scope(r, { ...base, round: 1, reviewedSha: r.r1 }, r.plain);
  assert.equal(out.mode, 'range');
  assert.equal(out.range, `${r.r1}..${r.plain}`);
  assert.equal(out.files, 1);
  assert.equal(out.security, false);
  assert.match(out.correctness, /^subagent: correctness-brief\.md/);
});

test('prepare and diff work from another directory and show exactly the range, at a per-head path', () => {
  const r = repo();
  const { out } = scope(r, { ...base, round: 1, reviewedSha: r.r1 }, r.route);
  assert.ok(out.dir.endsWith(`review-1-${r.route.slice(0, 7)}`));
  const elsewhere = mkdtempSync(join(tmpdir(), 'elsewhere-'));
  execFileSync(out.prepare.replace('git ', `git -C "${r.dir}" `), { cwd: elsewhere, shell: true, stdio: 'ignore' });
  const files = execFileSync(`${out.diff} --name-only`, { cwd: elsewhere, shell: true, encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(files, ['src/routes/auth/login.ts', 'src/services/report.ts']);
  execFileSync(out.cleanup, { cwd: r.dir, shell: true, stdio: 'ignore' });
  assert.equal(execFileSync('git', ['branch', '--list', 'review-*'], { cwd: r.dir, encoding: 'utf8' }).trim(), '');
});

test('a follow-up range that touches a route or auth file runs security again', () => {
  const r = repo();
  const { out } = scope(r, { ...base, round: 1, reviewedSha: r.plain }, r.route);
  assert.equal(out.security, true);
  assert.deepEqual(out.securityFiles, ['src/routes/auth/login.ts']);
});

test('the final pass reads the whole PR with the code-review skill, without security', () => {
  const r = repo();
  const { out } = scope(r, { ...base, round: 2, reviewedSha: r.plain }, r.route, ['--final']);
  assert.equal(out.mode, 'final');
  assert.equal(out.security, false);
  assert.equal(out.range, `${r.mainSha}..${r.route}`);
  assert.equal(out.correctness, 'code-review high 1');
});

test('nothing new pushed: scope says so and reviews nothing', () => {
  const r = repo();
  const { out } = scope(r, { ...base, round: 1, reviewedSha: r.r1 }, r.r1);
  assert.equal(out.same, true);
});

test('round 5 is refused with the open items, so the verdict becomes BLOCKED ON user', () => {
  const r = repo();
  const findings = [{ id: 'R9', fp: 'a:b:c', severity: 'medium', status: 'open', summary: 'still broken', where: 'a.ts:1', round: 4 }];
  const res = scope(r, { ...base, round: 4, reviewedSha: r.r1, findings }, r.plain);
  assert.equal(res.status, 5);
  assert.match(res.stderr, /past this PR's cap of 4/);
  assert.match(res.stderr, /BLOCKED ON user/);
  assert.match(res.stderr, /R9 \(medium\) still broken/);
});

test('rounds 2 to 4 are allowed', () => {
  const r = repo();
  assert.equal(scope(r, { ...base, round: 3, reviewedSha: r.r1 }, r.plain).status, 0);
});

test('scope refuses a stored state with no whole-number round', () => {
  const r = repo();
  for (const round of [undefined, 'x', -1, 2.5]) assert.equal(scope(r, { ...base, round, reviewedSha: r.r1 }, r.plain).status, 5);
});

test('an answered question with extraRounds lets the user allow more rounds', () => {
  const r = repo();
  const questions = [{ id: 'Q1', text: 'Allow two more rounds?', status: 'answered', answer: 'yes', extraRounds: 2 }];
  const res = scope(r, { ...base, round: 4, reviewedSha: r.r1, questions }, r.plain);
  assert.equal(res.status, 0);
  assert.equal(res.out.round, 5);
  assert.equal(res.out.cap, 6);
  const open = [{ ...questions[0], status: 'open', answer: null }];
  assert.equal(scope(r, { ...base, round: 4, reviewedSha: r.r1, questions: open }, r.plain).status, 5);
});

const put = (next, stored) => run(['put', '1', '--repo', 'o/r', '--file', stateFile(next), '--dry', ...(stored ? ['--stored', stateFile(stored)] : [])]);

test('put refuses a state past the cap', () => {
  assert.equal(put({ ...base, round: 5 }).status, 5);
  assert.equal(put({ ...base, round: 4 }).status, 0);
});

test('put refuses a round lower than the stored one, or missing, or not a whole number', () => {
  const stored = { ...base, round: 4 };
  const res = put({ ...base, round: 2 }, stored);
  assert.equal(res.status, 5);
  assert.match(res.stderr, /lower than the stored round 4/);
  const { round, ...noRound } = base;
  for (const next of [noRound, { ...base, round: 'x' }, { ...base, round: 0 }, { ...base, round: 4.5 }]) assert.equal(put(next, stored).status, 5);
  assert.equal(put({ ...base, round: 4 }, stored).status, 0);
});

test('extraRounds is granted only by answering a question the tracker held open, from 1 to 4', () => {
  const asked = { id: 'Q1', text: 'Allow more rounds?', status: 'open', answer: null };
  const stored = { ...base, round: 4, questions: [asked] };
  const grant = (extraRounds, from = stored) => put({ ...base, round: 4, questions: [{ ...asked, status: 'answered', answer: 'yes', extraRounds }] }, from);
  assert.equal(grant(2).status, 0);
  for (const bad of [-2, 0, 1.5, '3', 5, 1000]) {
    const res = grant(bad);
    assert.equal(res.status, 5, `extraRounds ${JSON.stringify(bad)} accepted`);
    assert.match(res.stderr, /from 1 to 4/);
  }
  // A question added already answered, with no open question stored, grants nothing.
  const res = grant(2, { ...base, round: 4, questions: [] });
  assert.equal(res.status, 5);
  assert.match(res.stderr, /already holds open/);
  // Once granted, the same value is kept; raising it later is refused.
  const granted = { ...base, round: 5, questions: [{ ...asked, status: 'answered', answer: 'yes', extraRounds: 2 }] };
  assert.equal(put(granted, granted).status, 0);
  assert.equal(put({ ...granted, questions: [{ ...granted.questions[0], extraRounds: 4 }] }, granted).status, 5);
  // scope ignores an out-of-range value.
  const r = repo();
  const q = [{ ...asked, status: 'answered', extraRounds: -3 }];
  assert.equal(scope(r, { ...base, round: 1, reviewedSha: r.r1, questions: q }, r.plain).out.cap, 4);
});

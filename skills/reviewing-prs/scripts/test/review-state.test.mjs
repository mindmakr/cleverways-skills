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

test('round 1 reviews the whole PR at high effort with security', () => {
  const r = repo();
  const { out } = scope(r, fresh, r.r1);
  assert.equal(out.mode, 'full');
  assert.equal(out.security, true);
  assert.equal(out.range, `${r.mainSha}..${r.r1}`);
  assert.match(out.codeReview, /code-review high$/);
});

test('a follow-up round reviews only the new range at medium, without security when no relevant path changed', () => {
  const r = repo();
  const { out } = scope(r, { ...base, round: 1, reviewedSha: r.r1 }, r.plain);
  assert.equal(out.mode, 'range');
  assert.equal(out.range, `${r.r1}..${r.plain}`);
  assert.equal(out.files, 1);
  assert.equal(out.security, false);
  assert.match(out.codeReview, /code-review high$/);
});

test('prepare gives code-review a default diff that is exactly the range', () => {
  const r = repo();
  const dir = join(mkdtempSync(join(tmpdir(), 'review-wt-')), 'wt');
  const { out } = scope(r, { ...base, round: 1, reviewedSha: r.r1 }, r.route, ['--dir', dir]);
  for (const c of out.prepare) execFileSync(c, { cwd: r.dir, shell: true, stdio: 'ignore' });
  // What the code-review skill reads when given no target.
  const reviewed = execFileSync('git', ['diff', '--name-only', '@{upstream}...HEAD'], { cwd: dir, encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(reviewed, ['src/routes/auth/login.ts', 'src/services/report.ts']);
  for (const c of out.cleanup) execFileSync(c, { cwd: r.dir, shell: true, stdio: 'ignore' });
});

test('a follow-up range that touches a route or auth file runs security again', () => {
  const r = repo();
  const { out } = scope(r, { ...base, round: 1, reviewedSha: r.plain }, r.route);
  assert.equal(out.security, true);
  assert.deepEqual(out.securityFiles, ['src/routes/auth/login.ts']);
});

test('the final pass reads the whole PR at medium, without security', () => {
  const r = repo();
  const { out } = scope(r, { ...base, round: 2, reviewedSha: r.plain }, r.route, ['--final']);
  assert.equal(out.mode, 'final');
  assert.equal(out.security, false);
  assert.equal(out.range, `${r.mainSha}..${r.route}`);
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

test('put refuses a state past the cap', () => {
  const res = run(['put', '1', '--repo', 'o/r', '--file', stateFile({ ...base, round: 5 }), '--dry']);
  assert.equal(res.status, 5);
  assert.equal(run(['put', '1', '--repo', 'o/r', '--file', stateFile({ ...base, round: 4 }), '--dry']).status, 0);
});

test('put refuses a round lower than the stored one', () => {
  const res = run(['put', '1', '--repo', 'o/r', '--file', stateFile({ ...base, round: 2 }), '--dry', '--stored', stateFile({ ...base, round: 3 })]);
  assert.equal(res.status, 5);
  assert.match(res.stderr, /lower than the stored round 3/);
  assert.equal(run(['put', '1', '--repo', 'o/r', '--file', stateFile({ ...base, round: 3 }), '--dry', '--stored', stateFile({ ...base, round: 3 })]).status, 0);
});

test('extraRounds must be a positive whole number, so it cannot lower or fudge the cap', () => {
  for (const extraRounds of [-2, 0, 1.5, '3']) {
    const questions = [{ id: 'Q1', text: 'More rounds?', status: 'answered', answer: 'yes', extraRounds }];
    const res = run(['put', '1', '--repo', 'o/r', '--file', stateFile({ ...base, round: 3, questions }), '--dry']);
    assert.equal(res.status, 5, `extraRounds ${JSON.stringify(extraRounds)} accepted`);
    assert.match(res.stderr, /positive whole number/);
  }
  const r = repo();
  const questions = [{ id: 'Q1', text: 'More rounds?', status: 'answered', answer: 'yes', extraRounds: -3 }];
  const res = scope(r, { ...base, round: 1, reviewedSha: r.r1, questions }, r.plain);
  assert.equal(res.out.cap, 4);
});

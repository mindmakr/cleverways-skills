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

// A throwaway repo: main has one file, the PR branch adds a plain file (with `lines` lines in all,
// so a large PR by default), then a plain fix, then a fix that touches a route.
function repo(lines = 3000) {
  const dir = mkdtempSync(join(tmpdir(), 'review-scope-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
  const put = (path, text) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); };
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  put('README.md', 'x\n'); g('add', '.'); g('commit', '-qm', 'base');
  const mainSha = g('rev-parse', 'HEAD');
  g('checkout', '-qb', 'pr');
  put('src/services/report.ts', 'a\n');
  if (lines > 1) put('src/services/big.ts', 'x\n'.repeat(lines - 1));
  g('add', '.'); g('commit', '-qm', 'r1');
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

test('round 1 reviews the whole PR with security; the code-review skill only when the checkout is at head', () => {
  const r = repo();
  const { out } = scope(r, fresh, r.route);
  assert.equal(out.mode, 'full');
  assert.equal(out.security, true);
  assert.equal(out.range, `${r.mainSha}..${r.route}`);
  assert.equal(out.correctness, 'code-review high 1');
  // The session's checkout is not at this head: the skill would read the wrong code.
  assert.match(scope(r, fresh, r.r1).out.correctness, /^subagent: reviewer-brief\.md/);
});

test('a follow-up round reviews only the new range, by subagent, without security when no relevant path changed', () => {
  const r = repo();
  const { out } = scope(r, { ...base, round: 1, reviewedSha: r.r1 }, r.plain);
  assert.equal(out.mode, 'range');
  assert.equal(out.range, `${r.r1}..${r.plain}`);
  assert.equal(out.files, 1);
  assert.equal(out.security, false);
  assert.match(out.correctness, /^subagent: reviewer-brief.md/);
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

const put = (next, stored, fixture, now) => run(['put', '1', '--repo', 'o/r', '--file', stateFile(next), '--dry',
  ...(stored ? ['--stored', stateFile(stored)] : []), ...(fixture ? ['--fixture', stateFile(fixture)] : []), ...(now ? ['--now', now] : [])]);
const roundReview = (n) => ({ id: 100 + n, body: `<!-- cleverways:review-round:${n} -->\n**NEEDS FIXES**` });

test('put refuses a state past the cap', () => {
  assert.equal(put({ ...base, round: 5 }).status, 5);
  assert.equal(put({ ...base, round: 4 }).status, 0);
});

test('put refuses a round lower than the stored one, or missing, or not a whole number', () => {
  const stored = { ...base, round: 4 };
  const res = put({ ...base, round: 2 }, stored);
  assert.equal(res.status, 5);
  assert.match(res.stderr, /lower than round 4/);
  const { round, ...noRound } = base;
  for (const next of [noRound, { ...base, round: 'x' }, { ...base, round: 0 }, { ...base, round: 4.5 }]) assert.equal(put(next, stored).status, 5);
  assert.equal(put({ ...base, round: 4 }, stored).status, 0);
});

test('deleting the tracker does not reset the round: the round reviews on the PR set a floor', () => {
  const reviews = [roundReview(1), roundReview(2), roundReview(3), roundReview(4)];
  // No tracker stored (deleted), the agent starts again at round 1: refused.
  const res = put({ ...base, round: 1 }, null, { reviews });
  assert.equal(res.status, 5);
  assert.match(res.stderr, /lower than round 4/);
  // scope with the same PR history refuses round 5 as past the cap.
  const r = repo();
  const s = run(['scope', '1', '--repo', 'o/r', '--state', stateFile({ ...base, round: 0, reviewedSha: null }), '--fixture', stateFile({ reviews }),
    '--base', 'main', '--head', r.plain], r.dir);
  assert.equal(s.status, 5);
  assert.match(s.stderr, /Round 5 is past/);
});

test('extraRounds needs the person\'s own PR comment, written after the question was asked', () => {
  const asked = { id: 'Q1', text: 'Allow more rounds?', status: 'open', answer: null, askedAt: '2026-11-06T10:00:00Z' };
  const stored = { ...base, round: 4, verdict: 'BLOCKED ON user', blockedOn: 'user', questions: [asked] };
  const reply = { id: 77, body: 'Q1: yes, allow 2 more rounds', created_at: '2026-11-06T11:00:00Z' };
  const grant = (q, fixture = { comments: [reply] }, from = stored) => put({ ...base, round: 4, questions: [{ ...asked, status: 'answered', answer: 'yes', ...q }] }, from, fixture);

  assert.equal(grant({ extraRounds: 2, answerComment: 77 }).status, 0);
  // The agent answers its own question: no comment from the person.
  let res = grant({ extraRounds: 2 });
  assert.equal(res.status, 5);
  assert.match(res.stderr, /needs answerComment/);
  // A comment written before the question was asked, by these skills, or not naming the question or number.
  for (const c of [{ ...reply, created_at: '2026-11-06T09:00:00Z' }, { ...reply, body: `<!-- cleverways:fix-note -->\n${reply.body}` },
    { ...reply, body: 'yes, more rounds' }, { ...reply, body: 'Q1: allow 3 more' }]) {
    assert.equal(grant({ extraRounds: 2, answerComment: 77 }, { comments: [c] }).status, 5, c.body);
  }
  // Self-open then self-answer in one put: the question was not stored open.
  res = grant({ extraRounds: 2, answerComment: 77 }, { comments: [reply] }, { ...stored, questions: [] });
  assert.equal(res.status, 5);
  assert.match(res.stderr, /already holds open/);
  // Self-open in one put (askedAt is stamped by the script, not the caller), then answer with an older comment.
  const opened = put({ ...base, round: 4, questions: [{ id: 'Q2', text: 'More?', status: 'open', askedAt: '2000-01-01T00:00:00Z' }] }, { ...base, round: 4 }, null, '2026-11-06T12:00:00Z');
  assert.equal(opened.status, 0);
  assert.match(opened.stdout, /"askedAt":"2026-11-06T12:00:00Z"/);
  // Out-of-range values are refused even with a comment.
  for (const bad of [-2, 0, 1.5, '3', 5, 1000]) {
    res = grant({ extraRounds: bad, answerComment: 77 });
    assert.equal(res.status, 5, `extraRounds ${JSON.stringify(bad)} accepted`);
    assert.match(res.stderr, /from 1 to 4/);
  }
  // Once granted it is kept; raising it later is refused.
  const granted = { ...stored, round: 5, questions: [{ ...asked, status: 'answered', answer: 'yes', extraRounds: 2, answerComment: 77 }] };
  assert.equal(put(granted, granted, { comments: [reply] }).status, 0);
  assert.equal(put({ ...granted, questions: [{ ...granted.questions[0], extraRounds: 4 }] }, granted, { comments: [reply] }).status, 5);
  // scope ignores an out-of-range value.
  const r = repo();
  const q = [{ ...asked, status: 'answered', extraRounds: -3 }];
  assert.equal(scope(r, { ...base, round: 1, reviewedSha: r.r1, questions: q }, r.plain).out.cap, 4);
});

test('follow-up rounds review the whole PR again below 3,000 changed lines, and only the range from there', () => {
  const large = repo(3000);
  let out = scope(large, { ...base, round: 1, reviewedSha: large.r1 }, large.plain).out;
  assert.equal(out.prLines, 3000);
  assert.equal(out.mode, 'range');
  assert.equal(out.range, `${large.r1}..${large.plain}`);
  const small = repo(2999);
  out = scope(small, { ...base, round: 1, reviewedSha: small.r1 }, small.plain).out;
  assert.equal(out.prLines, 2999);
  assert.equal(out.mode, 'full');
  assert.equal(out.range, `${small.mainSha}..${small.plain}`);
  assert.match(out.correctness, /^subagent: reviewer-brief\.md/); // checkout is not at this head
  // Security still follows only the new commits, not the whole PR.
  assert.equal(out.security, false);
  assert.equal(scope(small, { ...base, round: 1, reviewedSha: small.plain }, small.route).out.security, true);
});

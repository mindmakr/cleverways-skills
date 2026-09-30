import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changedSince, evidencePoint, parseEvidence, staleVerdict } from '../stale.mjs';

test('parseEvidence reads path:line citations, backticked paths and blob URLs', () => {
  const e = parseEvidence([
    { body: 'Root cause at `services/ewa.ts:120` and api/_client.ts:6-9.', createdAt: '2026-09-01T00:00:00Z' },
    { body: 'See https://github.com/o/r/blob/0a1b2c3d4e5f60718293a4b5c6d7e8f901234567/app/profile.tsx#L40', createdAt: '2026-09-05T00:00:00Z' },
  ]);
  assert.deepEqual(e.files.sort(), ['api/_client.ts', 'app/profile.tsx', 'services/ewa.ts']);
  assert.deepEqual(e.shas, ['0a1b2c3d4e5f60718293a4b5c6d7e8f901234567']);
  assert.equal(e.evidenceAt, '2026-09-05T00:00:00Z');
});

test('parseEvidence reads short SHAs and commit URLs, not versions, words or plain URLs', () => {
  const e = parseEvidence([{ body: 'Fixed in 18496b9 (see https://github.com/o/r/commit/abc1234def). Bumped v1.0.0 to 3.0.20; e.g. deadbeef is a word; https://example.com/a/b.html', createdAt: '2026-09-01T00:00:00Z' }]);
  assert.deepEqual(e.shas.sort(), ['18496b9', 'abc1234def']);
  assert.deepEqual(e.files, []);
});

test('parseEvidence keeps route-group brackets in paths, inside markdown links and parentheses', () => {
  const e = parseEvidence([{ body: [
    '[`profile.tsx#L312`](https://github.com/o/r/blob/acf8a196c134dade34c6c050c3a4133427af63d4/app/(auth)/(tabs)/profile.tsx#L312)',
    '(see frontend/src/app/(dashboard)/profile/page.tsx:466)',
  ].join('\n'), createdAt: '2026-09-01T00:00:00Z' }]);
  assert.deepEqual(e.files.sort(), ['app/(auth)/(tabs)/profile.tsx', 'frontend/src/app/(dashboard)/profile/page.tsx']);
});

test('parseEvidence drops paths outside the repo (../ or absolute)', () => {
  const e = parseEvidence([{ body: 'See ../payday-web-nextjs/backend/x.ts:12 and /etc/app/conf.ts:3 and api/y.ts:1', createdAt: '2026-09-01T00:00:00Z' }]);
  assert.deepEqual(e.files, ['api/y.ts']);
});

test('parseEvidence ignores agent config folders', () => {
  const e = parseEvidence([{ body: 'Rule in .agents/project-profile.md and .claude/settings.json; code in api/x.ts:3', createdAt: '2026-09-01T00:00:00Z' }]);
  assert.deepEqual(e.files, ['api/x.ts']);
});

test('parseEvidence with no citations has no evidence date', () => {
  assert.deepEqual(parseEvidence([{ body: 'The profile shows SA.', createdAt: '2026-09-01T00:00:00Z' }]), { files: [], shas: [], evidenceAt: null });
});

const NOW = Date.parse('2026-10-01T00:00:00Z');
test('staleVerdict: changed files win, then missing or old evidence, else unchanged', () => {
  const v = (o) => staleVerdict({ now: NOW, staleDays: 30, evidenceAt: '2026-09-20T00:00:00Z', files: ['a.ts'], changed: [], ...o });
  assert.equal(v({ changed: [{ sha: 'x' }] }), 'changed');
  assert.equal(v({ changed: [{ sha: 'x' }], evidenceAt: '2026-01-01T00:00:00Z' }), 'changed');
  assert.equal(v({ files: [] }), 'no-evidence');
  assert.equal(v({ evidenceAt: '2026-08-01T00:00:00Z' }), 'no-evidence');
  assert.equal(v({}), 'unchanged');
});

test('changedSince lists commits to cited files after the evidence, by SHA or by date', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stale-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim();
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
    writeFileSync(join(dir, 'a.ts'), '1'); writeFileSync(join(dir, 'b.ts'), '1');
    git('add', '.'); git('commit', '-qm', 'first', '--date', '2026-09-01T00:00:00Z');
    const first = git('rev-parse', 'HEAD');
    writeFileSync(join(dir, 'a.ts'), '2'); git('commit', '-qam', 'change a');
    git('rm', '-q', 'b.ts'); git('commit', '-qm', 'delete b');

    assert.deepEqual(changedSince(dir, 'main', first, ['a.ts']).map((c) => c.subject), ['change a']);
    assert.deepEqual(changedSince(dir, 'main', first, ['b.ts']).map((c) => c.subject), ['delete b']);
    assert.deepEqual(changedSince(dir, 'main', first, ['c.ts']), []);
    assert.deepEqual(changedSince(dir, 'main', '2000-01-01T00:00:00Z', ['a.ts']).map((c) => c.subject), ['change a', 'first']);
    assert.deepEqual(changedSince(dir, 'main', 'ffffffffff', ['a.ts']).length, 2, 'an unknown SHA falls back to all history');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('evidencePoint takes the newest cited SHA on the base, never one from an unrelated branch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stale-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim();
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
    writeFileSync(join(dir, 'a.ts'), '1'); git('add', '.'); git('commit', '-qm', 'one');
    const one = git('rev-parse', 'HEAD');
    writeFileSync(join(dir, 'a.ts'), '2'); git('commit', '-qam', 'two');
    const two = git('rev-parse', 'HEAD');
    git('checkout', '-q', '--orphan', 'shots'); writeFileSync(join(dir, 'shot.png'), 'x'); git('add', '.'); git('commit', '-qm', 'screenshots');
    const orphan = git('rev-parse', 'HEAD');
    git('checkout', '-q', 'main');

    assert.equal(evidencePoint(dir, 'main', [one, orphan, two], '2026-09-01T00:00:00Z'), two);
    assert.equal(evidencePoint(dir, 'main', [orphan], '2026-09-01T00:00:00Z'), '2026-09-01T00:00:00Z');
    assert.equal(evidencePoint(dir, 'main', [], null), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

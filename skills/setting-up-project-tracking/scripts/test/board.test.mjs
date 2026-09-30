import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findItem, readProfile, setItems, sprintForPr } from '../board.mjs';

const prUrl = 'https://github.com/o/r/pull/97';
const board = () => ({
  items: new Map([[prUrl, { id: 'PVTI_1', status: { name: 'In review' }, content: { __typename: 'PullRequest', url: prUrl, state: 'OPEN' } }]]),
  field: () => undefined,
});

test('findItem finds a PR card from owner/repo#n', () => {
  assert.equal(findItem(board(), 'o/r#97')?.id, 'PVTI_1');
});

test('findItem finds a PR card from its issues URL', () => {
  assert.equal(findItem(board(), 'https://github.com/o/r/issues/97')?.id, 'PVTI_1');
});

test('findItem returns undefined for a card not on the board', () => {
  assert.equal(findItem(board(), 'o/r#1'), undefined);
});

test('set on a PR already on the board keeps its Status and does not re-add it', () => {
  const b = board(), lines = [];
  setItems(b, {}, ['o/r#97'], {}, (l) => lines.push(l));
  assert.equal(b.items.get(prUrl).status.name, 'In review');
  assert.deepEqual(lines, ['o/r#97: no change']);
});

const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
const sprintBoard = (withCurrent = true) => {
  const issue = 'https://github.com/o/r/issues/5';
  const its = [{ id: 'I0', title: 'Sprint 0', startDate: day(-30), duration: 14 }];
  if (withCurrent) its.push({ id: 'I1', title: 'Sprint 1', startDate: day(-3), duration: 14 });
  return {
    items: new Map([[issue, { id: 'X', sprint: { title: 'Sprint 0' }, content: { __typename: 'Issue', url: issue } }]]),
    field: (n) => (n === 'Sprint' ? { configuration: { iterations: its } } : undefined),
  };
};

test('a PR takes the sprint of the first linked issue that has one', () => {
  assert.equal(sprintForPr(sprintBoard(), ['https://github.com/o/r/issues/9', 'https://github.com/o/r/issues/5']), 'Sprint 0');
});

test('a PR with no linked sprint takes the current sprint', () => {
  assert.equal(sprintForPr(sprintBoard(), []), 'current');
});

test('a PR gets no sprint when there is none to give', () => {
  assert.equal(sprintForPr(sprintBoard(false), []), null);
});

test('readProfile reads Owners, Status page, Thresholds and local paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'profile-'));
  mkdirSync(join(dir, 'app', '.agents'), { recursive: true });
  writeFileSync(join(dir, 'app', '.agents', 'project-profile.md'), [
    '# Profile', '', '## Repos', '', '| Role | GitHub | Local path |', '|---|---|---|',
    '| App | o/app | `.` |', '| API | o/api | `../api` |', '',
    '## Tracking', '',
    '- Board: https://github.com/users/o/projects/3',
    '- Owners: app → alice, api → bob',
    '- Status page: https://claude.ai/code/artifact/abc',
    '- Thresholds: stuck 5d, stale 60d', '',
  ].join('\n'));
  const p = readProfile(join(dir, 'app', '.agents', 'project-profile.md'));
  assert.deepEqual(p.owners, { app: 'alice', api: 'bob' });
  assert.equal(p.statusPage, 'https://claude.ai/code/artifact/abc');
  assert.deepEqual(p.thresholds, { stuck: 5, stale: 60, abandoned: 30 });
  assert.equal(p.localPaths['o/app'], join(dir, 'app'));
  assert.equal(p.localPaths['o/api'], join(dir, 'api'));
});

test('readProfile defaults thresholds and owners when the profile has none', () => {
  const dir = mkdtempSync(join(tmpdir(), 'profile-'));
  writeFileSync(join(dir, 'p.md'), '# P\n\n## Tracking\n\n- Board: https://github.com/users/o/projects/3\n');
  const p = readProfile(join(dir, 'p.md'));
  assert.deepEqual(p.owners, {});
  assert.deepEqual(p.thresholds, { stuck: 3, stale: 30, abandoned: 30 });
});

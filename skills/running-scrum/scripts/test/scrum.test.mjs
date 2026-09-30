import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flagsFor, rank, sprintStats, toItem } from '../scrum.mjs';

const NOW = Date.parse('2026-10-05T12:00:00Z');
const T = { stuck: 3, stale: 30, abandoned: 30 };
const SPRINT = { title: 'Sprint 1', startDate: '2026-09-27', duration: 14 };
const ago = (days) => new Date(NOW - days * 864e5).toISOString();

const issue = (over = {}) => ({
  ref: 'o/r#1', type: 'issue', state: 'OPEN', status: 'Ready', statusSince: ago(1), sprint: null,
  release: null, priority: null, assignees: ['ann'], labels: [], createdAt: ago(10), updatedAt: ago(1),
  blocking: 0, linkedPrs: '', ...over,
});
const pr = (over = {}, health = {}) => ({
  ...issue({ ref: 'o/r#50', type: 'pr', status: 'In review', ...over }),
  pr: { mergeable: 'MERGEABLE', checks: 'pass', headSha: 'abc', reviewedSha: 'abc', verdict: 'NEEDS FIXES', isDraft: false, isDependabot: false, ...health },
});
const flags = (item, sprint = SPRINT) => flagsFor(item, { now: NOW, thresholds: T, sprint });

test('an item in progress longer than the stuck threshold is stuck', () => {
  assert.ok(flags(issue({ status: 'In progress', statusSince: ago(4) })).includes('stuck'));
  assert.ok(!flags(issue({ status: 'In progress', statusSince: ago(2) })).includes('stuck'));
});

test('Backlog and Ready are never stuck', () => {
  assert.ok(!flags(issue({ status: 'Ready', statusSince: ago(40) })).includes('stuck'));
});

test('an issue in progress with nobody assigned is unassigned', () => {
  assert.ok(flags(issue({ status: 'In progress', assignees: [] })).includes('unassigned'));
});

test('an issue in the current sprint with nobody assigned is unassigned', () => {
  assert.ok(flags(issue({ sprint: 'Sprint 1', assignees: [] })).includes('unassigned'));
  assert.ok(!flags(issue({ assignees: [] })).includes('unassigned'));
});

test('a conflicting PR is flagged conflict', () => {
  assert.ok(flags(pr({}, { mergeable: 'CONFLICTING' })).includes('conflict'));
});

test('a PR with failing checks is flagged', () => {
  assert.ok(flags(pr({}, { checks: 'fail' })).includes('checks-failing'));
});

test('a PR reviewed on an older commit is review-behind-head', () => {
  assert.ok(flags(pr({}, { reviewedSha: 'old' })).includes('review-behind-head'));
});

test('a PR with no review tracker is review-behind-head', () => {
  assert.ok(flags(pr({}, { reviewedSha: null, verdict: null })).includes('review-behind-head'));
});

test('a draft PR is not asked for review', () => {
  assert.ok(!flags(pr({}, { reviewedSha: null, isDraft: true })).includes('review-behind-head'));
});

test('a PR untouched past the abandoned threshold is abandoned', () => {
  assert.ok(flags(pr({ updatedAt: ago(31) })).includes('abandoned'));
  assert.ok(!flags(pr({ updatedAt: ago(29) })).includes('abandoned'));
});

test('a sprint issue still Ready after half the sprint is not-started', () => {
  assert.ok(flags(issue({ sprint: 'Sprint 1', status: 'Ready' })).includes('not-started'));
  const early = { ...SPRINT, startDate: '2026-10-04' };
  assert.ok(!flags(issue({ sprint: 'Sprint 1', status: 'Ready' }), early).includes('not-started'));
});

test('with no current sprint, sprint flags are skipped and nothing throws', () => {
  const f = flags(issue({ sprint: 'Sprint 1', status: 'Ready', assignees: [] }), null);
  assert.ok(!f.includes('not-started'));
  assert.ok(!f.includes('unassigned'));
});

test('closed items get no flags', () => {
  assert.deepEqual(flags(issue({ state: 'CLOSED', status: 'In progress', assignees: [], statusSince: ago(9) })), []);
});

test('rank follows release, open PR, High/security, blocking, priority, age', () => {
  const items = [
    issue({ ref: 'x#late-release', release: 'v1.1.0', priority: 'High' }),
    issue({ ref: 'x#no-release', priority: 'High' }),
    issue({ ref: 'x#low-old', release: 'v1.0.0', priority: 'Low', createdAt: ago(90) }),
    issue({ ref: 'x#medium', release: 'v1.0.0', priority: 'Medium' }),
    issue({ ref: 'x#blocker', release: 'v1.0.0', priority: 'Medium', blocking: 2 }),
    issue({ ref: 'x#security', release: 'v1.0.0', priority: 'Low', labels: ['security'] }),
    issue({ ref: 'x#high', release: 'v1.0.0', priority: 'High', createdAt: ago(5) }),
    issue({ ref: 'x#high-older', release: 'v1.0.0', priority: 'High', createdAt: ago(20) }),
    issue({ ref: 'x#has-pr', release: 'v1.0.0', priority: 'Low', linkedPrs: '#9 open' }),
    issue({ ref: 'x#done', release: 'v1.0.0', priority: 'High', status: 'Done' }),
    pr({ ref: 'x#a-pr', release: 'v1.0.0' }),
  ];
  const order = rank(items, ['v1.0.0', 'v1.1.0']).map((r) => r.ref);
  assert.deepEqual(order, ['x#has-pr', 'x#high-older', 'x#high', 'x#security', 'x#blocker', 'x#medium', 'x#low-old', 'x#late-release', 'x#no-release']);
});

test('rank gives every item a reason and the same order twice', () => {
  const items = [issue({ ref: 'a#2', release: 'v1.0.0' }), issue({ ref: 'a#1', release: 'v1.0.0' })];
  const one = rank(items, ['v1.0.0']), two = rank([...items].reverse(), ['v1.0.0']);
  assert.deepEqual(one.map((r) => r.ref), two.map((r) => r.ref));
  assert.ok(one.every((r) => r.reason.includes('v1.0.0')));
});

test('sprintStats counts the current sprint and the previous sprint done', () => {
  const its = [{ title: 'Sprint 0', startDate: '2026-09-13', duration: 14 }, SPRINT];
  const items = [
    issue({ sprint: 'Sprint 1', status: 'Done' }), issue({ sprint: 'Sprint 1', status: 'On test' }),
    issue({ sprint: 'Sprint 1', status: 'In progress' }), issue({ sprint: 'Sprint 1', status: 'Ready' }),
    issue({ sprint: 'Sprint 0', status: 'Done' }), issue({ sprint: 'Sprint 0', status: 'Done' }),
    pr({ sprint: 'Sprint 1', status: 'In review' }),
  ];
  assert.deepEqual(sprintStats(items, its, NOW), {
    current: SPRINT, planned: 4, done: 1, onTest: 1, inProgress: 1, previous: 'Sprint 0', previousDone: 2,
  });
});

test('sprintStats with no sprints returns nulls', () => {
  assert.deepEqual(sprintStats([issue()], [], NOW), { current: null, planned: 0, done: 0, onTest: 0, inProgress: 0, previous: null, previousDone: 0 });
});

test('toItem maps a board item and PR health into a report item', () => {
  const boardItem = {
    updatedAt: ago(2), status: { name: 'In review' }, sprint: { title: 'Sprint 1' }, release: { name: 'v1.0.0' },
    priority: null, size: { name: 'S' }, prText: null, fixesText: { text: '#62' },
    content: { __typename: 'PullRequest', url: 'https://github.com/o/r/pull/78', number: 78, title: 'T', state: 'OPEN',
      createdAt: ago(9), updatedAt: ago(3), assignees: { nodes: [{ login: 'm' }] }, labels: { nodes: [{ name: 'bug' }] } },
  };
  const health = { mergeable: 'MERGEABLE', isDraft: false, headRefOid: 'h1', author: { login: 'dependabot' },
    commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] } };
  const it = toItem(boardItem, health, { reviewedSha: 'h0', verdict: 'NEEDS FIXES' });
  assert.equal(it.ref, 'o/r#78');
  assert.equal(it.type, 'pr');
  assert.equal(it.status, 'In review');
  assert.equal(it.release, 'v1.0.0');
  assert.deepEqual(it.assignees, ['m']);
  assert.equal(it.fixes, '#62');
  assert.deepEqual(it.pr, { mergeable: 'MERGEABLE', checks: 'fail', headSha: 'h1', reviewedSha: 'h0', verdict: 'NEEDS FIXES',
    author: 'dependabot', isDependabot: true, isDraft: false });
});

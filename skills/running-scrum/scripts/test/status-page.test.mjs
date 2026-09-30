import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../status-page.mjs';

const empty = {
  generatedAt: '2026-10-01T06:00:00Z', board: { url: 'https://github.com/users/o/projects/3', currentSprint: null },
  owners: {}, sprint: { current: null, planned: 0, done: 0, onTest: 0, inProgress: 0, previous: null, previousDone: 0 }, items: [], errors: [],
};
const full = {
  ...empty,
  board: { url: 'https://github.com/users/o/projects/3', currentSprint: { title: 'Sprint 1', startDate: '2026-09-27', duration: 14 } },
  owners: { app: 'mughira' },
  sprint: { current: { title: 'Sprint 1', startDate: '2026-09-27', duration: 14 }, planned: 7, done: 1, onTest: 2, inProgress: 1, previous: 'Sprint 0', previousDone: 3 },
  items: [
    { ref: 'o/app#95', url: 'https://github.com/o/app/pull/95', type: 'pr', title: 'Bump 35 packages', state: 'OPEN', status: 'In review', assignees: [], flags: ['conflict', 'review-behind-head'] },
    { ref: 'o/api#12', url: 'https://github.com/o/api/issues/12', type: 'issue', title: 'Fix sums', state: 'OPEN', status: 'In progress', assignees: ['sara'], flags: ['stuck'] },
    { ref: 'o/app#97', url: 'https://github.com/o/app/pull/97', type: 'pr', title: 'Dependabot ignores', state: 'OPEN', status: 'Ready to merge', assignees: ['mughira'], flags: [],
      pr: { verdict: 'READY TO MERGE', headSha: 'a', reviewedSha: 'a' } },
  ],
  errors: ['o/api#3: open PR not on the board'],
};

test('an empty report renders every section with a plain empty state', () => {
  const html = render(empty, '');
  for (const h of ['Sprint', 'Needs attention', 'Ready to merge', 'Ritual notes']) assert.ok(html.includes(h), h);
  assert.ok(html.includes('No current sprint'));
  assert.ok((html.match(/Nothing here/g) ?? []).length >= 2);
});

test('flagged items show their flags and owner, falling back to the repo owner', () => {
  const html = render(full, '');
  assert.match(html, /o\/app#95[\s\S]*conflict[\s\S]*mughira \(repo owner\)/);
  assert.match(html, /o\/api#12[\s\S]*stuck[\s\S]*sara/);
});

test('PRs ready to merge are listed on their own', () => {
  const ready = render(full, '').split('Ready to merge</h2>')[1];
  assert.ok(ready.includes('o/app#97'));
  assert.ok(!ready.split('</section>')[0].includes('o/app#95'));
});

test('sprint numbers and the day of the sprint are shown', () => {
  const html = render(full, '', Date.parse('2026-10-01T06:00:00Z'));
  assert.ok(html.includes('Day 5 of 14'));
  assert.match(html, /planned<\/dt><dd>7<\/dd>/);
});

test('notes are rendered as markdown and HTML in them is escaped', () => {
  const html = render(empty, '## Questions for you\n- Close **#95**? <script>alert(1)</script>\n- See [board](https://github.com/users/o/projects/3)');
  assert.ok(html.includes('<h3>Questions for you</h3>'));
  assert.ok(html.includes('<strong>#95</strong>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('<a href="https://github.com/users/o/projects/3">board</a>'));
});

test('report errors are shown, never dropped', () => {
  assert.ok(render(full, '').includes('open PR not on the board'));
});

test('the page has a title, both themes and no scripts', () => {
  const html = render(full, '');
  assert.match(html, /^<title>[^<]+<\/title>/);
  assert.ok(html.includes('prefers-color-scheme: dark'));
  assert.ok(html.includes(':root[data-theme="dark"]'));
  assert.ok(!/<script/i.test(html));
});

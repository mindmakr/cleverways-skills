import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = new URL('../review-state.mjs', import.meta.url).pathname;
const render = (state) => {
  const file = join(mkdtempSync(join(tmpdir(), 'review-state-')), 'state.json');
  writeFileSync(file, JSON.stringify(state));
  return execFileSync(process.execPath, [script, 'put', '1', '--repo', 'o/r', '--file', file, '--dry'], { encoding: 'utf8' });
};
const base = { pr: 1, round: 2, reviewedSha: 'abc1234def', issues: [7], verdict: 'READY TO MERGE', blockedOn: null, findings: [], questions: [] };

test('the tracker shows a local check run by the reviewer on the reviewed head', () => {
  const out = render({ ...base, checks: { where: 'local', command: 'pnpm check', sha: 'abc1234def', result: 'passed: 48 tests, 0 failed' } });
  assert.match(out, /Checks \(local\): `pnpm check` on `abc1234`: passed: 48 tests, 0 failed/);
});

test('the tracker shows no checks line when the state has none', () => {
  assert.doesNotMatch(render(base), /Checks/);
});

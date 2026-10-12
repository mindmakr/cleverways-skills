import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBody } from '../plan-to-github.mjs';

const made = { P: { repo: 'o/r', number: 53 }, T1: { repo: 'o/api', number: 9 } };

test('placeholders resolve in a body that still has them', () => {
  assert.equal(resolveBody('Part of {{P}}. After {{T1}}.', made), 'Part of o/r#53. After o/api#9.');
});

test('a reused issue left with {{P}} by a failed run gets it resolved on the rerun', () => {
  // On a rerun the issue is reused and its current body is what the first run posted.
  assert.equal(resolveBody('## Task\n\nPart of {{P}}.', made), '## Task\n\nPart of o/r#53.');
});

test('a body with nothing to resolve needs no update', () => {
  assert.equal(resolveBody('Part of o/r#53.', made), null);
  assert.equal(resolveBody('', made), null);
  assert.equal(resolveBody(null, made), null);
});

test('an unknown key stays as it is, and alone needs no update', () => {
  assert.equal(resolveBody('See {{X}}.', made), null);
  assert.equal(resolveBody('See {{X}} and {{P}}.', made), 'See {{X}} and o/r#53.');
});

test('importing the script runs nothing', () => {
  assert.equal(typeof resolveBody, 'function');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const parity = fileURLToPath(new URL('../i18n-parity.mjs', import.meta.url));
const check = (files) => {
  const dir = mkdtempSync(join(tmpdir(), 'i18n-parity-'));
  for (const [l, data] of Object.entries(files)) writeFileSync(join(dir, `${l}.json`), JSON.stringify(data));
  const r = spawnSync(process.execPath, [parity, dir, '--base', 'en', '--json'], { encoding: 'utf8' });
  return { status: r.status, result: JSON.parse(r.stdout)[0] };
};

test('a placeholder inside an ICU branch does not make the file i18next', () => {
  const { status, result } = check({
    en: { a: '{by, select, platform {PayDay} other {{company}}} changed it', b: 'Hello {name}' },
    ar: { a: '{by, select, platform {PayDay} other {{company}}} غيّرها', b: 'مرحبا {name}' },
  });
  assert.deepEqual(result.syntax, []);
  assert.equal(status, 0);
});

test('{{var}} in an ICU file is still a syntax error', () => {
  const { status, result } = check({ en: { b: 'Hello {name}' }, ar: { b: 'مرحبا {{name}}' } });
  assert.deepEqual(result.syntax, ['b']);
  assert.equal(status, 1);
});

test('an i18next file flags ICU {var} and accepts {{var}}', () => {
  const { result } = check({ en: { a: 'Hi {{name}}', b: 'Bye {{name}}' }, ar: { a: 'مرحبا {{name}}', b: 'وداعا {name}' } });
  assert.deepEqual(result.syntax, ['b']);
});

test('missing, extra, empty and sameAsBase are reported', () => {
  const { status, result } = check({ en: { a: 'Home', b: 'Save', c: 'Go' }, ar: { a: 'Home', b: '', x: 'زائد' } });
  assert.deepEqual(result.missing, ['c']);
  assert.deepEqual(result.extra, ['x']);
  assert.deepEqual(result.empty, ['b']);
  assert.deepEqual(result.sameAsBase, ['a']);
  assert.equal(status, 1);
});

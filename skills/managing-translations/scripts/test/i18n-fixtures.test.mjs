// Each folder in fixtures/ holds en.json, ar.json and "expect": the exit code
// parity must give. The ICU outcomes match @formatjs/icu-messageformat-parser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const parity = fileURLToPath(new URL('../i18n-parity.mjs', import.meta.url));
const root = fileURLToPath(new URL('./fixtures/', import.meta.url));

for (const name of readdirSync(root)) {
  const dir = join(root, name);
  const expected = Number(readFileSync(join(dir, 'expect'), 'utf8').trim());
  test(`fixture ${name} ${expected ? 'fails' : 'passes'}`, () => {
    const r = spawnSync(process.execPath, [parity, dir, '--base', 'en'], { encoding: 'utf8' });
    assert.equal(r.status, expected, r.stdout + r.stderr);
  });
}

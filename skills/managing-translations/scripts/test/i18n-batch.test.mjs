import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extract, merge, splitKey } from '../i18n-batch.mjs';

const script = fileURLToPath(new URL('../i18n-batch.mjs', import.meta.url));
const parity = fileURLToPath(new URL('../i18n-parity.mjs', import.meta.url));
const run = (bin, args, cwd) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', cwd });

const en = {
  app: { title: 'OK', hello: 'Hello {name}', items: '{count, plural, one {# item} other {# items}}' },
  nav: { home: 'Home', settings: 'Settings' },
  'audit.event': { 'ewa.cancelled': 'Request cancelled' },
};
const ar = {
  app: { title: 'OK', hello: 'مرحبا {name}' },
  nav: { home: 'Home', settings: 'الإعدادات' },
};

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'i18n-batch-'));
  writeFileSync(join(dir, 'en.json'), JSON.stringify(en, null, 2) + '\n');
  writeFileSync(join(dir, 'ar.json'), JSON.stringify(ar, null, 2) + '\n');
  return dir;
}
const read = (dir, l) => JSON.parse(readFileSync(join(dir, `${l}.json`), 'utf8'));
const fill = (batch, values) => {
  for (const items of Object.values(batch.files)) for (const [k, item] of Object.entries(items)) if (k in values) item[batch.locale] = values[k];
  return batch;
};
const good = {
  'app.items': '{count, plural, zero {لا عناصر} one {عنصر} two {عنصران} few {# عناصر} many {# عنصرًا} other {# عنصر}}',
  'nav.home': 'الرئيسية',
  'audit.event.ewa.cancelled': 'أُلغي الطلب',
};

test('extract lists missing and sameAsBase keys in base order, with the base text', () => {
  const dir = fixture();
  const batch = extract([dir], { locale: 'ar' });
  const items = batch.files[join(dir, 'ar.json')];
  assert.deepEqual(Object.keys(items), ['app.items', 'nav.home', 'audit.event.ewa.cancelled']);
  assert.deepEqual(items['app.items'], { en: en.app.items, ar: '' });
  assert.deepEqual(items['nav.home'], { en: 'Home', ar: 'Home' });
  assert.equal(batch.locale, 'ar');
  assert.match(batch.rules, /placeholder/);
});

test('extract --keys missing leaves sameAsBase keys out; a short code is not sameAsBase', () => {
  const dir = fixture();
  const items = extract([dir], { locale: 'ar', kinds: ['missing'] }).files[join(dir, 'ar.json')];
  assert.deepEqual(Object.keys(items), ['app.items', 'audit.event.ewa.cancelled']);
});

test('extract rejects an unknown kind', () => {
  assert.throws(() => extract([fixture()], { locale: 'ar', kinds: ['extra'] }), /unknown --keys kind/);
});

test('merge writes nested keys in base order and parity then passes', () => {
  const dir = fixture();
  const { errors, written } = merge(fill(extract([dir], { locale: 'ar' }), good));
  assert.deepEqual(errors, []);
  assert.deepEqual(written.map(({ added, changed }) => ({ added, changed })), [{ added: 2, changed: 1 }]);
  const out = read(dir, 'ar');
  assert.deepEqual(Object.keys(out.app), ['title', 'hello', 'items']);
  assert.deepEqual(Object.keys(out), ['app', 'nav', 'audit.event']);
  assert.equal(out['audit.event']['ewa.cancelled'], 'أُلغي الطلب');
  assert.equal(out.nav.home, 'الرئيسية');
  assert.ok(readFileSync(join(dir, 'ar.json'), 'utf8').endsWith('}\n'));
  assert.equal(run(parity, [dir, '--base', 'en']).status, 0);
});

test('merge refuses the whole batch on a placeholder mismatch and writes nothing', () => {
  const dir = fixture();
  const before = readFileSync(join(dir, 'ar.json'), 'utf8');
  const { errors } = merge(fill(extract([dir], { locale: 'ar' }), { ...good, 'nav.home': 'الرئيسية {user}' }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /nav\.home: placeholders \{user\} but en has \{\}/);
  assert.equal(readFileSync(join(dir, 'ar.json'), 'utf8'), before);
});

test('merge refuses empty values, {{var}} in an ICU file, and base text changed since extract', () => {
  const dir = fixture();
  const batch = fill(extract([dir], { locale: 'ar' }), { ...good, 'app.items': '', 'nav.home': '{{x}}' });
  batch.files[join(dir, 'ar.json')]['audit.event.ewa.cancelled'].en = 'Old text';
  const { errors } = merge(batch);
  assert.equal(errors.length, 3);
  assert.match(errors.join('\n'), /app\.items: empty/);
  assert.match(errors.join('\n'), /nav\.home: wrong placeholder syntax/);
  assert.match(errors.join('\n'), /ewa\.cancelled: en text changed since extract/);
});

test('merge refuses a key the base does not have', () => {
  const dir = fixture();
  const batch = { base: 'en', locale: 'ar', files: { [join(dir, 'ar.json')]: { 'nav.gone': { en: 'Gone', ar: 'ذهب' } } } };
  assert.match(merge(batch).errors[0], /nav\.gone: not in en\.json/);
});

test('merge creates the locale file for a new language', () => {
  const dir = fixture();
  const batch = extract([dir], { locale: 'ur' });
  const items = batch.files[join(dir, 'ur.json')];
  for (const [k, item] of Object.entries(items)) item.ur = k === 'app.hello' ? 'سلام {name}' : k === 'app.items' ? good['app.items'] : `ترجمہ ${k}`;
  assert.deepEqual(merge(batch).errors, []);
  assert.deepEqual(Object.keys(read(dir, 'ur')), ['app', 'nav', 'audit.event']);
});

test('splitKey finds keys that hold dots', () => {
  assert.deepEqual(splitKey(en, 'audit.event.ewa.cancelled'), ['audit.event', 'ewa.cancelled']);
  assert.deepEqual(splitKey(en, 'app.hello'), ['app', 'hello']);
  assert.equal(splitKey(en, 'app.nope'), null);
});

test('the CLI extracts to a file, refuses a bad merge with exit 1, and reports what it wrote', () => {
  const dir = fixture();
  const out = join(dir, 'ar.batch.json');
  const ex = run(script, ['extract', dir, '--locale', 'ar', '--out', out]);
  assert.equal(ex.status, 0, ex.stderr);
  assert.match(ex.stdout, /ar: 3 keys \(missing, sameAsBase\)/);

  const batch = JSON.parse(readFileSync(out, 'utf8'));
  writeFileSync(out, JSON.stringify(fill(batch, { ...good, 'nav.home': 'x {y}' })));
  const bad = run(script, ['merge', '--in', out]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Refused, nothing written/);

  writeFileSync(out, JSON.stringify(fill(batch, good)));
  const dry = run(script, ['merge', '--in', out, '--dry-run']);
  assert.match(dry.stdout, /would write .*: 2 added, 1 changed, 0 unchanged/);
  assert.equal(read(dir, 'ar').nav.home, 'Home');
  const ok = run(script, ['merge', '--in', out]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /wrote .*ar\.json: 2 added, 1 changed, 0 unchanged/);
});

test('the CLI writes no batch file when nothing is left to translate', () => {
  const dir = fixture();
  const out = join(dir, 'en-GB.batch.json');
  writeFileSync(join(dir, 'en-GB.json'), JSON.stringify(en));
  const r = run(script, ['extract', dir, '--locale', 'en-GB', '--keys', 'missing', '--out', out]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /nothing to translate/);
  assert.equal(existsSync(out), false);
});

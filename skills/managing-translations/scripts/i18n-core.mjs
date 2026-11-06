// Shared by i18n-parity.mjs and i18n-batch.mjs: reading locale files and
// comparing one locale against the base. Node built-ins only.
//
// Two formats, picked once per folder from the base file:
//   ICU (next-intl, formatjs): {name}, {n, plural, one {# day} other {# days}}
//   i18next: {{name}}, plurals as separate keys (days_one, days_other)
// ICU values are parsed (icu-parse.mjs), so branch keys and branch text are
// never read as variables, rich-text tags count like arguments, and a value
// formatjs would reject is a syntax error.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { icuNames } from './icu-parse.mjs';

export const LOCALE_FILE = /^[a-z]{2}(-[A-Z]{2})?\.json$/;

export function flatten(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out.set(key, v);
  }
  return out;
}

// ---- i18next ----------------------------------------------------------------

const I18NEXT_VAR = /\{\{\s*-?\s*([A-Za-z_][\w.]*)\s*(?:,[^}]*)?\}\}/g;
const i18nextNames = (v) => new Set([...v.matchAll(I18NEXT_VAR)].map((m) => m[1]));
// An ICU argument or a lone brace left once the {{var}}s, and the options of
// $t(key, {...}) nesting, are taken out.
const NESTING = /\$t\([^()]*?,\s*\{[^()]*\}\s*\)/g;
const i18nextBad = (v) => /[{}]/.test(v.replace(I18NEXT_VAR, '').replace(NESTING, ''));
// i18next plural forms: a language may say "one day" without the number.
const I18NEXT_PLURAL_FORM = /_(zero|one|two|few|many)$/;

// ---- Format and comparison --------------------------------------------------

const parses = (v) => { try { icuNames(v); return true; } catch { return false; } };

// i18next if a base value uses {{var}} and is not valid ICU.
export function formatOf(baseMap) {
  for (const v of baseMap.values()) if (typeof v === 'string' && /\{\{\s*-?\s*[A-Za-z_]/.test(v) && !parses(v)) return 'i18next';
  return 'icu';
}

// { ok, names } for one value; ok is false on a syntax error.
export function analyse(value, format) {
  if (typeof value !== 'string') return { ok: true, names: new Set() };
  if (format === 'i18next') return { ok: !i18nextBad(value), names: i18nextNames(value) };
  try { return { ok: true, names: icuNames(value) }; } catch { return { ok: false, names: new Set() }; }
}

// Null when the value's arguments match the base, else a sentence saying how not.
export function placeholderProblem(key, value, baseValue, format) {
  const mine = analyse(value, format).names;
  const theirs = analyse(baseValue, format).names;
  if (format === 'i18next' && I18NEXT_PLURAL_FORM.test(key) && !mine.has('count')) theirs.delete('count');
  const fmt = (s) => `{${[...s].sort().join(',')}}`;
  const same = mine.size === theirs.size && [...mine].every((n) => theirs.has(n));
  return same ? null : `placeholders ${fmt(mine)} but the base has ${fmt(theirs)}`;
}

export const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
export const loadFlat = (path) => (existsSync(path) ? flatten(readJson(path)) : new Map());

// Compare one locale map with the base map. Keys are listed in base order.
export function compare(baseMap, map, format = formatOf(baseMap)) {
  const r = { missing: [], extra: [], empty: [], syntax: [], placeholder: [], sameAsBase: [] };
  for (const [key, baseValue] of baseMap) {
    if (!map.has(key)) { r.missing.push(key); continue; }
    const value = map.get(key);
    if (value === '' || value === null) r.empty.push(key);
    else if (!analyse(value, format).ok) r.syntax.push(key);
    else if (placeholderProblem(key, value, baseValue, format)) r.placeholder.push(key);
    else if (typeof value === 'string' && value === baseValue && /[A-Za-z]{3,}/.test(value)) r.sameAsBase.push(key);
  }
  for (const key of map.keys()) if (!baseMap.has(key)) r.extra.push(key);
  return r;
}

export function checkDir(dir, base) {
  const files = readdirSync(dir).filter((f) => LOCALE_FILE.test(f));
  const baseFile = `${base}.json`;
  if (!files.includes(baseFile)) throw new Error(`${dir}: no ${baseFile}`);
  const baseMap = loadFlat(join(dir, baseFile));
  const format = formatOf(baseMap);
  return files.filter((f) => f !== baseFile).map((f) => ({
    dir, locale: basename(f, '.json'), ...compare(baseMap, loadFlat(join(dir, f)), format),
  }));
}

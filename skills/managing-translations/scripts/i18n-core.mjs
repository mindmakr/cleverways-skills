// Shared by i18n-parity.mjs and i18n-batch.mjs: reading locale files and
// comparing one locale against the base. Node built-ins only.
//
// Two formats, picked once per folder from the base file:
//   ICU (next-intl, formatjs): {name}, {n, plural, one {# day} other {# days}}
//   i18next: {{name}}, plurals as separate keys (days_one, days_other)
// ICU values are parsed, not matched with patterns, so branch keys and branch
// text are never read as variables, and a malformed value is a syntax error.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

export const LOCALE_FILE = /^[a-z]{2}(-[A-Z]{2})?\.json$/;

export function flatten(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out.set(key, v);
  }
  return out;
}

// ---- ICU MessageFormat parser -------------------------------------------
// Returns the set of argument names at every depth. Throws on bad syntax.

const TYPES = new Set(['number', 'date', 'time', 'spellout', 'ordinal', 'duration']);
const CHOICE = new Set(['plural', 'selectordinal', 'select']);

export function icuArguments(src) {
  let i = 0;
  const names = new Set();
  const fail = (why) => { throw new SyntaxError(`${why} at ${i}`); };
  const ws = () => { while (i < src.length && /\s/.test(src[i])) i++; };
  const word = () => { const s = i; while (i < src.length && !/[\s{},]/.test(src[i])) i++; return src.slice(s, i); };

  // Text and arguments until the end, or until the "}" that closes a branch.
  function message(nested, inPlural) {
    while (i < src.length) {
      const c = src[i];
      if (c === "'") {
        const next = src[i + 1];
        if (next === "'") { i += 2; continue; }
        if (next === '{' || next === '}' || (inPlural && next === '#')) {
          // Quoted literal: runs to the next lone quote ('' inside is a quote), or to the end.
          i += 2;
          while (i < src.length) {
            if (src[i] === "'" && src[i + 1] === "'") i += 2;
            else if (src[i] === "'") { i++; break; }
            else i++;
          }
          continue;
        }
        i++;
      } else if (c === '{') {
        i++;
        argument();
      } else if (c === '}') {
        if (!nested) fail('unmatched }');
        return;
      } else i++;
    }
    if (nested) fail('unclosed branch');
  }

  function argument() {
    ws();
    if (src[i] === '{') fail('an argument name cannot start with {');
    const name = word();
    if (!name) fail('empty argument name');
    names.add(name);
    ws();
    if (src[i] === '}') { i++; return; }
    if (src[i] !== ',') fail('expected , or }');
    i++; ws();
    const type = word();
    ws();
    if (src[i] === '}') {
      if (!TYPES.has(type)) fail(`unknown argument type "${type}"`);
      i++; return;
    }
    if (src[i] !== ',') fail('expected , or }');
    i++;
    if (CHOICE.has(type)) return choice(type !== 'select');
    if (!TYPES.has(type)) fail(`unknown argument type "${type}"`);
    // Style, such as "::currency/SAR" or "short": balanced text up to the closing brace.
    for (let depth = 0; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && depth-- === 0) { i++; return; }
    }
    fail('unclosed argument');
  }

  function choice(plural) {
    ws();
    if (plural && src.startsWith('offset:', i)) { i += 7; ws(); if (!/\d/.test(src[i] ?? '')) fail('bad offset'); while (/\d/.test(src[i] ?? '')) i++; }
    const keys = new Set();
    for (;;) {
      ws();
      if (src[i] === '}') break;
      if (i >= src.length) fail('unclosed argument');
      const key = word();
      if (!key || !(plural ? /^(=\d+|[A-Za-z_]\w*)$/ : /^[A-Za-z_][\w-]*$/).test(key)) fail(`bad branch key "${key}"`);
      if (keys.has(key)) fail(`duplicate branch "${key}"`);
      keys.add(key);
      ws();
      if (src[i] !== '{') fail('expected { after branch key');
      i++;
      message(true, plural);
      i++; // the branch's closing }
    }
    if (!keys.has('other')) fail('missing "other" branch');
    i++;
  }

  message(false, false);
  return names;
}

// ---- i18next ----------------------------------------------------------------

const I18NEXT_VAR = /\{\{\s*-?\s*([A-Za-z_][\w.]*)\s*(?:,[^}]*)?\}\}/g;
const i18nextNames = (v) => new Set([...v.matchAll(I18NEXT_VAR)].map((m) => m[1]));
// An ICU argument or a lone brace left once the {{var}}s are taken out.
const i18nextBad = (v) => /[{}]/.test(v.replace(I18NEXT_VAR, ''));
// i18next plural forms: a language may say "one day" without the number.
const I18NEXT_PLURAL_FORM = /_(zero|one|two|few|many)$/;

// ---- Format and comparison --------------------------------------------------

const parses = (v) => { try { icuArguments(v); return true; } catch { return false; } };

// i18next if a base value uses {{var}} and is not valid ICU.
export function formatOf(baseMap) {
  for (const v of baseMap.values()) if (typeof v === 'string' && /\{\{\s*-?\s*[A-Za-z_]/.test(v) && !parses(v)) return 'i18next';
  return 'icu';
}

// { ok, names } for one value; ok is false on a syntax error.
export function analyse(value, format) {
  if (typeof value !== 'string') return { ok: true, names: new Set() };
  if (format === 'i18next') return { ok: !i18nextBad(value), names: i18nextNames(value) };
  try { return { ok: true, names: icuArguments(value) }; } catch { return { ok: false, names: new Set() }; }
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

// Shared by i18n-parity.mjs and i18n-batch.mjs: reading locale files and
// comparing one locale against the base. Node built-ins only.

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

export function placeholders(value) {
  if (typeof value !== 'string') return '';
  const names = new Set();
  // Drop ICU plural branch bodies ("=0 {none}", "other {# days}") so their words
  // are not read as variables. Repeat for nested branches.
  let prev;
  do { prev = value; value = value.replace(/(=\d+|zero|one|two|few|many|other)\s*\{[^{}]*\}/g, ''); } while (value !== prev);
  for (const m of value.matchAll(/\{\{?\s*([A-Za-z_]\w*)\s*(?=[,}])/g)) names.add(m[1]);
  return [...names].sort().join(',');
}

// Walk the braces once. A {{var}} at depth 0 is an i18next variable; one inside
// an ICU construct, as in "other {{company}}", is a branch around {company}.
function scan(v) {
  let depth = 0, i18next = false, balanced = true;
  for (let i = 0; i < v.length; i++) {
    if (depth === 0 && /^\{\{\s*[A-Za-z_][\w.]*\s*\}\}/.test(v.slice(i, i + 80))) i18next = true;
    if (v[i] === '{') depth++;
    else if (v[i] === '}' && --depth < 0) balanced = false;
  }
  return { i18next, balanced: balanced && depth === 0 };
}
const i18nextVar = (v) => typeof v === 'string' && scan(v).i18next;

// The base locale decides the syntax: any i18next {{var}} means i18next, otherwise ICU.
// Unbalanced braces are wrong in either.
export function syntaxChecker(baseMap) {
  const i18next = [...baseMap.values()].some(i18nextVar);
  return (v) => typeof v === 'string' && (!scan(v).balanced || (i18next
    ? /\{\s*\w+\s*,\s*(plural|select)/.test(v) || /(^|[^{])\{\s*[A-Za-z_]\w*\s*\}(?!\})/.test(v)
    : i18nextVar(v)));
}

export const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
export const loadFlat = (path) => (existsSync(path) ? flatten(readJson(path)) : new Map());

// Compare one locale map with the base map. Keys are listed in base order.
export function compare(baseMap, map, wrongSyntax = syntaxChecker(baseMap)) {
  const r = { missing: [], extra: [], empty: [], syntax: [], placeholder: [], sameAsBase: [] };
  for (const [key, baseValue] of baseMap) {
    if (!map.has(key)) { r.missing.push(key); continue; }
    const value = map.get(key);
    if (value === '' || value === null) r.empty.push(key);
    else if (wrongSyntax(value)) r.syntax.push(key);
    else if (placeholders(value) !== placeholders(baseValue)) r.placeholder.push(key);
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
  const wrongSyntax = syntaxChecker(baseMap);
  return files.filter((f) => f !== baseFile).map((f) => ({
    dir, locale: basename(f, '.json'), ...compare(baseMap, loadFlat(join(dir, f)), wrongSyntax),
  }));
}

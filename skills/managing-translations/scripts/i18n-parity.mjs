#!/usr/bin/env node
// Compares every <locale>.json in a directory against a base locale.
// Errors (exit 1): missing keys, extra keys, empty values, wrong syntax for the
// file's format (ICU in an i18next file, or {{var}} in an ICU file).
// Warnings: placeholder mismatch, value identical to the base (possibly untranslated).
//
// Usage: node i18n-parity.mjs <dir> [<dir> ...] [--base en] [--json]
// Handles next-intl ICU ({name}, {count, plural, ...}) and i18next ({{name}}).

import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
};
const json = args.includes('--json');
if (json) args.splice(args.indexOf('--json'), 1);
const base = flag('--base') ?? 'en';
const dirs = args;

if (dirs.length === 0) {
  console.error('Usage: node i18n-parity.mjs <dir> [<dir> ...] [--base en] [--json]');
  process.exit(2);
}

function flatten(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out.set(key, v);
  }
  return out;
}

function placeholders(value) {
  if (typeof value !== 'string') return '';
  const names = new Set();
  // Drop ICU plural branch bodies ("=0 {none}", "other {# days}") so their words
  // are not read as variables. Repeat for nested branches.
  let prev;
  do { prev = value; value = value.replace(/(=\d+|zero|one|two|few|many|other)\s*\{[^{}]*\}/g, ''); } while (value !== prev);
  for (const m of value.matchAll(/\{\{?\s*([A-Za-z_]\w*)\s*(?=[,}])/g)) names.add(m[1]);
  return [...names].sort().join(',');
}

function checkDir(dir) {
  const files = readdirSync(dir).filter((f) => /^[a-z]{2}(-[A-Z]{2})?\.json$/.test(f));
  const load = (f) => flatten(JSON.parse(readFileSync(join(dir, f), 'utf8')));
  const baseFile = `${base}.json`;
  if (!files.includes(baseFile)) throw new Error(`${dir}: no ${baseFile}`);
  const baseMap = load(baseFile);
  // The base locale decides the syntax: any {{var}} means i18next, otherwise ICU.
  const i18next = [...baseMap.values()].some((v) => typeof v === 'string' && v.includes('{{'));
  const wrongSyntax = (v) => typeof v === 'string' && (i18next
    ? /\{\s*\w+\s*,\s*(plural|select)/.test(v) || /(^|[^{])\{\s*[A-Za-z_]\w*\s*\}(?!\})/.test(v)
    : v.includes('{{'));

  return files.filter((f) => f !== baseFile).map((f) => {
    const map = load(f);
    const r = { dir, locale: basename(f, '.json'), missing: [], extra: [], empty: [], syntax: [], placeholder: [], sameAsBase: [] };
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
  });
}

const results = dirs.flatMap(checkDir);
const failed = results.some((r) => r.missing.length || r.extra.length || r.empty.length || r.syntax.length);

if (json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const r of results) {
    console.log(`\n${r.dir} · ${r.locale} vs ${base}`);
    for (const kind of ['missing', 'extra', 'empty', 'syntax', 'placeholder', 'sameAsBase']) {
      const keys = r[kind];
      console.log(`  ${kind.padEnd(12)} ${keys.length}`);
      for (const k of keys.slice(0, 20)) console.log(`    ${k}`);
      if (keys.length > 20) console.log(`    … ${keys.length - 20} more (use --json)`);
    }
  }
}
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
// Moves the keys a locale lacks into one small batch file, and merges the
// translated batch back into the locale files.
//
//   extract <dir> [<dir> ...] --locale ar [--base en] [--keys missing,sameAsBase] [--out ar.batch.json]
//   merge --in ar.batch.json [--dry-run]
//
// Kinds for --keys: missing, empty, syntax, placeholder, sameAsBase.
// A batch file looks like:
//   { "base": "en", "locale": "ar", "rules": "...",
//     "files": { "<abs path>/ar.json": { "a.b": { "en": "Hi {name}", "ar": "" } } } }
// The translator fills only the locale values. Merge refuses the whole batch,
// writing nothing, if any value is empty, has other placeholders than the base,
// uses the wrong syntax, or its base text changed since extract.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { flatten, placeholders, syntaxChecker, compare, readJson, loadFlat } from './i18n-core.mjs';

export const KINDS = ['missing', 'empty', 'syntax', 'placeholder', 'sameAsBase'];

const rules = (base, locale) =>
  `Write the ${locale} translation of each "${base}" text into its "${locale}" value. Translate the meaning, not word for word. ` +
  'Keep every {placeholder}, {{placeholder}}, ICU plural or select keyword, # sign and HTML tag exactly as in the source; ' +
  `add the plural branches ${locale} needs. Leave brand names, codes and units as they are. Change nothing else.`;

export function extract(dirs, { base = 'en', locale, kinds = ['missing', 'sameAsBase'] }) {
  if (!locale) throw new Error('--locale is required');
  const bad = kinds.filter((k) => !KINDS.includes(k));
  if (bad.length) throw new Error(`unknown --keys kind: ${bad.join(', ')} (use ${KINDS.join(', ')})`);
  const batch = { base, locale, rules: rules(base, locale), files: {} };
  for (const dir of dirs) {
    const basePath = join(dir, `${base}.json`);
    if (!existsSync(basePath)) throw new Error(`${dir}: no ${base}.json`);
    const baseMap = loadFlat(basePath);
    const map = loadFlat(join(dir, `${locale}.json`));
    const r = compare(baseMap, map);
    const picked = new Set(kinds.flatMap((k) => r[k]));
    const items = {};
    for (const key of baseMap.keys()) {
      if (!picked.has(key)) continue;
      items[key] = { [base]: baseMap.get(key), [locale]: map.has(key) ? map.get(key) ?? '' : '' };
    }
    if (Object.keys(items).length) batch.files[resolve(dir, `${locale}.json`)] = items;
  }
  return batch;
}

// Split a flat key into its path in the base object. Keys may themselves hold
// dots, so try the longest existing segment first.
export function splitKey(obj, key) {
  const parts = key.split('.');
  for (let i = parts.length; i > 0; i--) {
    const head = parts.slice(0, i).join('.');
    if (!obj || typeof obj !== 'object' || !(head in obj)) continue;
    if (i === parts.length) return [head];
    const rest = splitKey(obj[head], parts.slice(i).join('.'));
    if (rest) return [head, ...rest];
  }
  return null;
}

// Set obj[key] = value. A new key goes after its nearest earlier sibling in the
// base, so the locale file keeps the base's order without reordering anything else.
function put(obj, baseObj, key, value) {
  if (key in obj) { obj[key] = value; return; }
  const order = Object.keys(baseObj ?? {});
  const at = order.indexOf(key);
  const entries = Object.entries(obj);
  let pos = entries.length;
  if (at !== -1) {
    pos = 0;
    entries.forEach(([k], i) => { const j = order.indexOf(k); if (j !== -1 && j < at) pos = i + 1; });
  }
  entries.splice(pos, 0, [key, value]);
  for (const k of Object.keys(obj)) delete obj[k];
  for (const [k, v] of entries) obj[k] = v;
}

function setPath(obj, baseObj, path, value) {
  const [head, ...rest] = path;
  if (!rest.length) return put(obj, baseObj, head, value);
  const child = obj[head];
  if (child === null || typeof child !== 'object' || Array.isArray(child)) put(obj, baseObj, head, {});
  setPath(obj[head], baseObj?.[head], rest, value);
}

const sameType = (a, b) => (Array.isArray(a) ? Array.isArray(b) : typeof a === typeof b);

export function checkBatch(batch) {
  const { base, locale } = batch;
  const errors = [];
  for (const [file, items] of Object.entries(batch.files ?? {})) {
    const basePath = join(dirname(file), `${base}.json`);
    if (!existsSync(basePath)) { errors.push(`${file}: no ${base}.json beside it`); continue; }
    const baseMap = flatten(readJson(basePath));
    const wrongSyntax = syntaxChecker(baseMap);
    for (const [key, item] of Object.entries(items)) {
      const value = item?.[locale];
      const src = baseMap.get(key);
      const fail = (why) => errors.push(`${file} ${key}: ${why}`);
      if (!baseMap.has(key)) fail(`not in ${base}.json`);
      else if (JSON.stringify(src) !== JSON.stringify(item[base])) fail(`${base} text changed since extract`);
      else if (value === undefined || value === null || value === '' || (typeof value === 'string' && !value.trim())) fail('empty');
      else if (!sameType(src, value)) fail(`type differs from ${base}`);
      else if (wrongSyntax(value)) fail('wrong placeholder syntax for this file');
      else if (placeholders(value) !== placeholders(src)) fail(`placeholders {${placeholders(value)}} but ${base} has {${placeholders(src)}}`);
    }
  }
  return errors;
}

export function merge(batch, { dryRun = false } = {}) {
  const errors = checkBatch(batch);
  if (errors.length) return { errors, written: [] };
  const { base, locale } = batch;
  const written = [];
  for (const [file, items] of Object.entries(batch.files ?? {})) {
    const baseObj = readJson(join(dirname(file), `${base}.json`));
    const raw = existsSync(file) ? readFileSync(file, 'utf8') : null;
    const obj = raw ? JSON.parse(raw) : {};
    const before = flatten(obj);
    let added = 0, changed = 0, unchanged = 0;
    for (const [key, item] of Object.entries(items)) {
      const value = item[locale];
      if (!before.has(key)) added++;
      else if (JSON.stringify(before.get(key)) !== JSON.stringify(value)) changed++;
      else { unchanged++; continue; }
      setPath(obj, baseObj, splitKey(baseObj, key), value);
    }
    if ((added || changed) && !dryRun) {
      const indent = raw?.match(/\n([ \t]+)"/)?.[1] ?? '  ';
      const eol = raw === null || raw.endsWith('\n') ? '\n' : '';
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(obj, null, indent) + eol);
    }
    written.push({ file, added, changed, unchanged });
  }
  return { errors: [], written };
}

function main(argv) {
  const [cmd, ...args] = argv;
  const flag = (name) => {
    const i = args.indexOf(name);
    if (i === -1) return undefined;
    const value = args[i + 1];
    args.splice(i, 2);
    return value;
  };
  const bool = (name) => { const i = args.indexOf(name); if (i === -1) return false; args.splice(i, 1); return true; };

  if (cmd === 'extract') {
    const locale = flag('--locale');
    const base = flag('--base') ?? 'en';
    const kinds = (flag('--keys') ?? 'missing,sameAsBase').split(',').map((s) => s.trim()).filter(Boolean);
    const out = flag('--out') ?? `${locale}.batch.json`;
    if (!locale || !args.length) return usage();
    const batch = extract(args, { base, locale, kinds });
    const counts = Object.entries(batch.files).map(([f, items]) => `  ${Object.keys(items).length}  ${f}`);
    const total = Object.values(batch.files).reduce((n, items) => n + Object.keys(items).length, 0);
    if (!total) { console.log(`${locale}: nothing to translate (${kinds.join(', ')})`); return 0; }
    writeFileSync(out, JSON.stringify(batch, null, 2) + '\n');
    console.log(`${locale}: ${total} keys (${kinds.join(', ')}) written to ${resolve(out)}\n${counts.join('\n')}`);
    return 0;
  }
  if (cmd === 'merge') {
    const input = flag('--in');
    const dryRun = bool('--dry-run');
    if (!input) return usage();
    const { errors, written } = merge(readJson(input), { dryRun });
    if (errors.length) {
      console.error(`Refused, nothing written. ${errors.length} problem(s):`);
      for (const e of errors) console.error(`  ${e}`);
      return 1;
    }
    for (const w of written) console.log(`${dryRun ? 'would write' : 'wrote'} ${w.file}: ${w.added} added, ${w.changed} changed, ${w.unchanged} unchanged`);
    return 0;
  }
  return usage();
}

function usage() {
  console.error('Usage:\n  node i18n-batch.mjs extract <dir> [<dir> ...] --locale <code> [--base en] [--keys missing,sameAsBase] [--out file]\n  node i18n-batch.mjs merge --in <file> [--dry-run]');
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try { process.exit(main(process.argv.slice(2))); } catch (e) { console.error(e.message); process.exit(2); }
}

#!/usr/bin/env node
// Compares every <locale>.json in a directory against a base locale.
// Errors (exit 1): missing keys, extra keys, empty values, wrong syntax for the
// file's format (ICU in an i18next file, or {{var}} in an ICU file).
// Warnings: placeholder mismatch, value identical to the base (possibly untranslated).
//
// Usage: node i18n-parity.mjs <dir> [<dir> ...] [--base en] [--json]
// Handles next-intl ICU ({name}, {count, plural, ...}) and i18next ({{name}}).

import { checkDir } from './i18n-core.mjs';

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

const results = dirs.flatMap((dir) => checkDir(dir, base));
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

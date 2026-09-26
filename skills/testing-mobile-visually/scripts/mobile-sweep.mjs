#!/usr/bin/env node
// Runs Maestro visual flows once per locale on a LOCAL emulator or simulator.
// Collects screenshots, flow failures and JavaScript errors from logcat (Android).
// Refuses an API URL that is not on this machine or its local network.
//
// Usage: node mobile-sweep.mjs --flows .maestro/visual --app-id <id> --api-url <url>
//          --locales en,ar [--out .visual-tests/mobile] [--only <text>] [--env KEY=VALUE ...]
// Exit 0: every flow passed and no JS errors. 1: failures (see manifest.json). 2: setup error.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { adbPath, maestroPath, toolEnv } from './tools.mjs';

const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(`--${name}`); return i === -1 ? null : argv[i + 1]; };
const all = (name) => argv.flatMap((a, i) => (a === `--${name}` ? [argv[i + 1]] : []));
const die = (msg) => { console.error(msg); process.exit(2); };

const flowsDir = resolve(arg('flows') ?? die('Missing --flows'));
const appId = arg('app-id') ?? die('Missing --app-id');
const api = new URL(arg('api-url') ?? die('Missing --api-url (the URL the app calls)'));
const localNet = /^(localhost|127\.0\.0\.1|10\.0\.2\.2|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;
if (!localNet.test(api.hostname)) die(`Refusing ${api.hostname}: visual tests run against a local backend only.`);

const maestro = maestroPath() ?? die('Maestro not found. Run: node setup.mjs (in this folder)');
const adb = adbPath();
const env = toolEnv();

const locales = (arg('locales') ?? 'en').split(',');
const only = arg('only');
const flows = readdirSync(flowsDir).filter((f) => /\.ya?ml$/.test(f) && f !== 'config.yaml' && (!only || f.includes(only)));
const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = resolve(arg('out') ?? '.visual-tests/mobile', runId);
const extraEnv = all('env').flatMap((kv) => ['-e', kv]);
const manifest = { runId, appId, apiUrl: api.href, results: [] };

for (const locale of locales) {
  const dir = join(outDir, locale);
  mkdirSync(dir, { recursive: true });
  for (const flow of flows) {
    if (adb) spawnSync(adb, ['logcat', '-c']);
    // Screenshots are written relative to the working directory, so run inside the output folder.
    const res = spawnSync(maestro, ['test', join(flowsDir, flow), '-e', `APP_ID=${appId}`, '-e', `LOCALE=${locale}`, ...extraEnv],
      { cwd: dir, env, shell: process.platform === 'win32', encoding: 'utf8' });
    const findings = [];
    if (res.status !== 0) findings.push({ check: 'flow-failed', detail: (res.stdout + res.stderr).split('\n').filter((l) => /fail|error|not found|assert/i.test(l)).slice(0, 5).join(' | ') });
    if (adb) {
      const log = spawnSync(adb, ['logcat', '-d', '-s', 'ReactNativeJS:E', 'flutter:E', 'AndroidRuntime:E'], { encoding: 'utf8' }).stdout ?? '';
      for (const line of log.split('\n').filter((l) => /\sE\s/.test(l)).slice(0, 10)) findings.push({ check: 'app-error', detail: line.trim().slice(0, 300) });
    }
    const name = flow.replace(/\.ya?ml$/, '');
    const shots = readdirSync(dir).filter((f) => f.endsWith('.png') && f.startsWith(name)).map((f) => join(dir, f));
    manifest.results.push({ flow, locale, status: res.status === 0 ? 'passed' : 'failed', screenshots: shots, findings });
    console.log(`${findings.length ? '✗' : '✓'} ${locale} ${flow}${findings.length ? ` (${findings.map((f) => f.check).join(', ')})` : ''}`);
  }
}

writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
const total = manifest.results.reduce((n, r) => n + r.findings.length, 0);
console.log(`\n${manifest.results.length} flow runs, ${total} automatic findings → ${join(outDir, 'manifest.json')}`);
process.exit(total ? 1 : 0);

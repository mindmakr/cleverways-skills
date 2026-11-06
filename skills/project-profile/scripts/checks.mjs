#!/usr/bin/env node
// Runs a project's checks quietly: full output goes to a log file, and each
// command prints one line, so test output does not fill the session.
//
// Usage:
//   node checks.mjs [--only <words>] [--profile <path>] [--root <dir>]
//   node checks.mjs --cmd '<command>' [--dir <dir>] [--root <dir>]
//
//   --only     comma-separated words; runs the Commands rows whose Purpose
//              contains one of them (case-insensitive). Default: every row.
//   --profile  default .agents/project-profile.md under --root.
//   --root     repository root. Default: the current directory.
//   --cmd      runs one command (a single test file, say) instead of the table.
//   --dir      where --cmd runs, relative to --root. Default: the root.
//
// Reads the "## Commands" table (Purpose | Command | Run from). A Command cell
// that is not one backticked command is printed as SKIP. Each command runs in
// each backticked "Run from" directory (the root when there is none) and prints:
//   PASS <purpose> [<dir>] (<secs>s)
//   FAIL <purpose> [<dir>] (<secs>s): <up to 10 failing tests or errors> log: <path>
// Exit 0 when every command passes, 1 otherwise.

import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_NAMES = 10;
const MAX_NAME_LEN = 160;

// Splits a markdown table row on pipes that are outside backticks.
export function splitRow(line) {
  const cells = [];
  let cur = '';
  let tick = false;
  const s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '`') tick = !tick;
    if (c === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (c === '|' && !tick) { cells.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

const spans = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());

// Returns [{ purpose, command | null, dirs: [] }] from the "## Commands" table.
export function parseCommands(markdown) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Commands\s*$/i.test(l.trim()));
  if (start === -1) throw new Error('no "## Commands" section in the profile');
  const rows = [];
  let inTable = false;
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2}\s/.test(line)) break;
    if (!line.trim().startsWith('|')) { if (inTable) break; continue; }
    const cells = splitRow(line);
    if (!inTable) { inTable = true; continue; } // header row
    if (cells.every((c) => /^:?-*:?$/.test(c))) continue; // separator row
    const [purpose = '', commandCell = '', fromCell = ''] = cells;
    if (!purpose) continue;
    const whole = commandCell.match(/^`([^`]+)`$/);
    rows.push({ purpose, command: whole ? whole[1].trim() : null, dirs: spans(fromCell) });
  }
  return rows;
}

// Splits leading NAME=value assignments off a command, so they work without a POSIX shell.
export function splitEnv(command) {
  const env = {};
  let rest = command.trim();
  const re = /^([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|[^\s"']*)(\s+|$)/;
  let m;
  while ((m = rest.match(re))) {
    let v = m[2];
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    env[m[1]] = v;
    rest = rest.slice(m[0].length);
  }
  return { env, command: rest };
}

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const clip = (s) => (s.length > MAX_NAME_LEN ? `${s.slice(0, MAX_NAME_LEN - 3)}...` : s);
const dropTime = (s) => s.replace(/\s*\(?\d+(?:\.\d+)?\s?m?s\)?$/, '');

// Pulls failing test names, or the first error lines, out of a command's output.
export function failures(text) {
  const lines = stripAnsi(text).split(/\r?\n/);
  const found = [];
  const add = (s) => {
    s = s.replace(/\s+/g, ' ').trim();
    if (s && !found.includes(s)) found.push(s);
  };
  let eslintFile = null;
  for (const line of lines) {
    let m;
    if ((m = line.match(/^\s*FAIL\s+(.+)$/))) add(m[1].replace(/\s*\[.*\]$/, '')); // vitest, jest
    else if ((m = line.match(/^\s*[×✗✕✖]\s+(.+)$/))) { // vitest, jest, node:test spec
      const name = dropTime(m[1]);
      if (!/^failing tests:?$|^\d+ problems? \(/i.test(name)) add(name); // not node's or eslint's summary
    } else if ((m = line.match(/^\s*●\s+(.+)$/))) { if (!/^Console$/.test(m[1].trim())) add(m[1]); } // jest
    else if ((m = line.match(/^\s*not ok \d+ - (.+)$/))) add(m[1].replace(/\s+#.*$/, '')); // TAP, node:test
    else if (/error TS\d+/.test(line)) add(line); // tsc
    else if (/^(?:[A-Za-z]:)?[\\/]?\S.*\.\w+$/.test(line) && !/\s{2}/.test(line)) eslintFile = line.trim();
    else if ((m = line.match(/^\s+(\d+:\d+)\s+error\s+(.+)$/)) && eslintFile) { // eslint stylish
      add(`${eslintFile.split(/[\\/]/).slice(-2).join('/')}:${m[1]} ${m[2]}`);
    }
  }
  // A short name inside a longer entry (vitest "x" inside "file > suite > x") is the same test.
  const names = found.filter((s) => !found.some((o) => o !== s && o.length > s.length && /[>›]\s*$/.test(o.slice(0, o.length - s.length)) && o.endsWith(s)));
  if (names.length) return names.slice(0, MAX_NAMES).map(clip);
  const nonEmpty = lines.map((l) => l.trim()).filter(Boolean);
  const errors = nonEmpty.filter((l) => /\berror\b|\bERR!/i.test(l));
  return (errors.length ? errors.slice(0, MAX_NAMES) : nonEmpty.slice(-3)).map(clip);
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'check';

function run({ command, cwd, logFile }) {
  const { env, command: bare } = splitEnv(command);
  const fd = openSync(logFile, 'w');
  return new Promise((done) => {
    const child = spawn(bare, {
      cwd,
      shell: true,
      stdio: ['ignore', fd, fd],
      env: { ...process.env, ...env, FORCE_COLOR: '0', NO_COLOR: '1' },
      windowsHide: true,
    });
    child.on('error', (e) => { closeSync(fd); done({ code: 1, error: e.message }); });
    child.on('close', (code, signal) => { closeSync(fd); done({ code: code ?? (signal ? 1 : 0) }); });
  });
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].match(/^--(only|profile|root|cmd|dir)$/)?.[1];
    if (!name || argv[i + 1] === undefined) throw new Error(`unknown or incomplete option: ${argv[i]}`);
    opts[name] = argv[++i];
  }
  return opts;
}

async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) {
    console.error(`${e.message}\nUsage: checks.mjs [--only <words>] [--profile <path>] [--root <dir>] | --cmd '<command>' [--dir <dir>]`);
    return 1;
  }
  const root = resolve(opts.root ?? '.');
  let rows;
  if (opts.cmd) rows = [{ purpose: opts.cmd, command: opts.cmd, dirs: opts.dir ? [opts.dir] : [] }];
  else {
    const profile = resolve(root, opts.profile ?? '.agents/project-profile.md');
    if (!existsSync(profile)) { console.error(`No profile at ${profile}`); return 1; }
    try { rows = parseCommands(readFileSync(profile, 'utf8')); } catch (e) { console.error(`${e.message}: ${profile}`); return 1; }
    if (opts.only) {
      const words = opts.only.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
      rows = rows.filter((r) => words.some((w) => r.purpose.toLowerCase().includes(w)));
      if (!rows.length) { console.error(`No Commands row matches --only ${opts.only}`); return 1; }
    }
  }
  const logDir = mkdtempSync(join(tmpdir(), 'checks-'));
  let failed = false;
  let n = 0;
  for (const row of rows) {
    if (!row.command) { console.log(`SKIP ${row.purpose} (not a command)`); continue; }
    for (const dir of row.dirs.length ? row.dirs : ['.']) {
      const cwd = resolve(root, dir);
      const logFile = join(logDir, `${++n}-${slug(row.purpose)}.log`);
      const t0 = Date.now();
      let result;
      if (!existsSync(cwd) || !statSync(cwd).isDirectory()) result = { code: 1, error: `directory not found: ${cwd}` };
      else result = await run({ command: row.command, cwd, logFile });
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      const head = `${row.purpose} [${dir}] (${secs}s)`;
      if (result.code === 0) { console.log(`PASS ${head}`); continue; }
      failed = true;
      const output = existsSync(logFile) ? readFileSync(logFile, 'utf8') : '';
      const why = result.error ? [result.error] : failures(output);
      console.log(`FAIL ${head}: ${why.join('; ') || `exit ${result.code}`} log: ${existsSync(logFile) ? logFile : 'none'}`);
    }
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; });
}

#!/usr/bin/env node
// Checks GitHub Actions workflows for the settings that stop a broken build from burning the
// month's minutes. A failing job that restarts on every push, runs for GitHub's default 360
// minutes, or runs on macOS (10x the Linux price) can use a whole budget in a day.
//
//   every job           has timeout-minutes (reusable-workflow calls are exempt: they cannot)
//   push / pull_request has a concurrency group, so a new push cancels the run it replaces
//   push / pull_request no macOS or Windows runner (keep those for tags, releases or manual runs)
//   schedule            no cron more often than once an hour
//
// Usage: node workflow-limits.mjs [file.yml | dir ...]   (default: .github/workflows)
// Exit: 0 clean, 1 problems found, 2 no workflow files at the path. Line-based, no dependencies, so CI can fetch and run it alone.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function workflowLimits(text, path) {
  const lines = text.replace(/\r/g, '').split('\n');
  const problems = [];
  const jobsAt = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (jobsAt === -1) return problems;
  const header = lines.slice(0, jobsAt).join('\n');
  const onEveryChange = runsOnEveryChange(lines.slice(0, jobsAt));
  if (onEveryChange && !/^concurrency:/m.test(text) && !/^ {4}concurrency:/m.test(text))
    problems.push(`${path}: runs on push or pull_request with no concurrency group, so each push queues another full run instead of cancelling the old one`);
  for (const m of header.matchAll(/cron:\s*['"]?([^'"\n]+)['"]?/g)) {
    const minute = m[1].trim().split(/\s+/)[0];
    const every = minute.match(/^\*\/(\d+)$/);
    if (minute === '*' || (every && Number(every[1]) < 60) || minute.includes(','))
      problems.push(`${path}: schedule "${m[1].trim()}" runs more than once an hour`);
  }
  const jobs = [];
  for (let i = jobsAt + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\S/.test(l)) break;
    const m = l.match(/^ {2}([\w-]+):\s*(#.*)?$/);
    if (m) jobs.push({ name: m[1], line: i + 1, body: [] });
    else if (jobs.length) jobs[jobs.length - 1].body.push(l);
  }
  for (const j of jobs) {
    const body = j.body.join('\n');
    if (/^ {4}uses:/m.test(body)) continue;
    if (!/^ {4}timeout-minutes:/m.test(body))
      problems.push(`${path}:${j.line} job "${j.name}" has no timeout-minutes, so a hung run can take GitHub's default 360 minutes`);
    const runners = [...body.matchAll(/(runs-on|os):\s*(.+)/g)].map((x) => x[2]).join(' ');
    if (onEveryChange && /macos|windows/i.test(runners))
      problems.push(`${path}:${j.line} job "${j.name}" runs on ${/macos/i.test(runners) ? 'macOS' : 'Windows'} for every push or PR (macOS costs 10x Linux, Windows 2x). Limit it to tags, releases or manual runs`);
  }
  return problems;
}

// True when pushes or pull requests start the workflow. A push trigger limited to tags is a
// release, not every change, so it does not count.
function runsOnEveryChange(header) {
  const inline = header.find((l) => /^on:\s*\S/.test(l));
  if (inline) return /\b(push|pull_request|pull_request_target)\b/.test(inline);
  for (let i = 0; i < header.length; i++) {
    const m = header[i].match(/^ {2}(push|pull_request|pull_request_target):\s*(.*)$/);
    if (!m) continue;
    if (m[1] !== 'push') return true;
    const keys = [];
    for (let k = i + 1; k < header.length; k++) {
      const l = header[k];
      if (!l.trim() || /^\s*#/.test(l)) continue;
      if (!/^ {3,}/.test(l)) break;
      const key = l.match(/^ {4}([\w-]+):/);
      if (key) keys.push(key[1]);
    }
    if (!(keys.length && keys.every((k) => k === 'tags' || k === 'tags-ignore'))) return true;
  }
  return false;
}

function files(args) {
  const out = [];
  for (const a of args.length ? args : ['.github/workflows']) {
    if (!existsSync(a)) continue;
    if (statSync(a).isDirectory()) { for (const f of readdirSync(a)) if (/\.ya?ml$/.test(f)) out.push(join(a, f)); }
    else out.push(a);
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const list = files(process.argv.slice(2));
  if (!list.length) { console.log('No workflow files found at the given path.'); process.exit(2); }
  const found = list.flatMap((f) => workflowLimits(readFileSync(f, 'utf8'), f.replace(/\\/g, '/')));
  for (const p of found) console.log(p);
  console.log(found.length ? `${found.length} workflow problem(s).` : 'Workflows: every job is time-limited and cancels on a new push.');
  process.exit(found.length ? 1 : 0);
}

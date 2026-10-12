#!/usr/bin/env node
// Creates an approved plan on GitHub: labels, a milestone per repo, a parent issue, child
// issues, and native sub-issue links. Re-running is safe: an issue whose exact title already
// exists in that repo is reused, and existing sub-issue links are kept.
//
// Usage: node plan-to-github.mjs --plan plan.json [--dry]
//
// plan.json:
// {
//   "milestone": { "title": "…", "description": "…", "due_on": "2026-10-31T00:00:00Z" } | null,
//   "parent": { "key": "P", "repo": "owner/repo", "title": "…", "body": "…", "labels": ["epic"] }
//          | { "key": "P", "repo": "owner/repo", "number": 123 },
//   "items": [ { "key": "T1", "repo": "owner/repo", "title": "…", "body": "…", "labels": ["task"], "parent": "P",
//                "size": "S", "platform": "Web", "depends": ["T0"] } ],
//   "release": "v1.1.0"
// }
// Bodies may reference other entries as {{T1}}; they become owner/repo#n after creation. A rerun
// also resolves them in reused and existing issues whose body still holds a {{KEY}}.
// When the profile names a board, every issue goes on it: tasks with nothing in "depends" are
// Ready, the rest Backlog, with their Size, Platform, priority label and the plan's Release.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { openBoard, readProfile, setItems } from '../../setting-up-project-tracking/scripts/board.mjs';

const COLORS = { epic: '3E4B9E', feature: '1D76DB', replace: 'D93F0B', refactor: '5319E7', task: 'C5DEF5' };
const gh = (args, input) => execFileSync('gh', args, { encoding: 'utf8', input, maxBuffer: 1 << 26 });
const api = (args) => JSON.parse(gh(['api', ...args]) || 'null');

// The body with each {{KEY}} of a known entry replaced by owner/repo#n, or null when nothing changes.
// Unknown keys stay as written. `made` maps key → { repo, number }.
export function resolveBody(body, made) {
  if (!body?.includes('{{')) return null;
  const out = body.replace(/\{\{(\w+)\}\}/g, (all, k) => (made[k] ? `${made[k].repo}#${made[k].number}` : all));
  return out === body ? null : out;
}

function main() {
  const argv = process.argv.slice(2);
  const planPath = argv[argv.indexOf('--plan') + 1];
  const dry = argv.includes('--dry');
  if (!argv.includes('--plan') || !planPath) { console.error('Usage: plan-to-github.mjs --plan plan.json [--dry]'); process.exit(2); }
  const plan = JSON.parse(readFileSync(planPath, 'utf8'));
  const entries = [plan.parent, ...plan.items].filter(Boolean);


  if (dry) {
    const repos = [...new Set(entries.map((e) => e.repo))];
    console.log(`Milestone: ${plan.milestone?.title ?? '(none)'} in ${repos.join(', ')}`);
    for (const e of entries) console.log(`${e.key.padEnd(5)} ${e.repo} ${e.number ? `#${e.number} (existing)` : e.title}  [${(e.labels ?? []).join(', ')}]${e.parent ? `  ← sub-issue of ${e.parent}` : ''}${e.size ? `  ${e.size}` : ''}${e.depends?.length ? `  after ${e.depends.join(', ')}` : ''}`);
    console.log(`Board: ${readProfile().board ?? '(none in the profile)'}${plan.release ? `, Release ${plan.release}` : ''}`);
    return;
  }

  // 1. Labels.
  for (const repo of new Set(entries.map((e) => e.repo))) {
    const have = new Set(api(['--paginate', '--slurp', `repos/${repo}/labels?per_page=100`]).flat().map((l) => l.name));
    for (const name of new Set(entries.filter((e) => e.repo === repo).flatMap((e) => e.labels ?? []))) {
      if (!have.has(name)) gh(['label', 'create', name, '-R', repo, '--color', COLORS[name] ?? 'BFD4F2']);
    }
  }

  // 2. Milestone in every repo the plan touches.
  const milestone = {};
  if (plan.milestone) {
    for (const repo of new Set(entries.map((e) => e.repo))) {
      const all = api(['--paginate', '--slurp', `repos/${repo}/milestones?state=all&per_page=100`]).flat();
      const found = all.find((m) => m.title === plan.milestone.title);
      milestone[repo] = found?.number ?? api(['-X', 'POST', `repos/${repo}/milestones`, '-f', `title=${plan.milestone.title}`,
        '-f', `description=${plan.milestone.description ?? ''}`, ...(plan.milestone.due_on ? ['-f', `due_on=${plan.milestone.due_on}`] : [])]).number;
    }
  }

  // 3. Issues, reused by exact title.
  const made = {};
  for (const e of entries) {
    if (e.number) {
      const i = api([`repos/${e.repo}/issues/${e.number}`]);
      made[e.key] = { repo: e.repo, number: i.number, id: i.id, url: i.html_url, body: i.body, how: 'existing' };
      continue;
    }
    const hits = JSON.parse(gh(['issue', 'list', '-R', e.repo, '--state', 'all', '--search', `in:title "${e.title}"`, '--json', 'number,title,url', '--limit', '20']));
    const same = hits.find((h) => h.title === e.title);
    if (same) {
      const i = api([`repos/${e.repo}/issues/${same.number}`]);
      made[e.key] = { repo: e.repo, number: i.number, id: i.id, url: i.html_url, body: i.body, how: 'reused' };
      continue;
    }
    const i = api(['-X', 'POST', `repos/${e.repo}/issues`, '-f', `title=${e.title}`, '-f', `body=${e.body ?? ''}`,
      ...(e.labels ?? []).flatMap((l) => ['-f', `labels[]=${l}`]),
      ...(milestone[e.repo] ? ['-F', `milestone=${milestone[e.repo]}`] : [])]);
    made[e.key] = { repo: e.repo, number: i.number, id: i.id, url: i.html_url, body: i.body, how: 'created' };
  }

  // 4. Resolve {{KEY}} references in every issue whose body still holds one: created now, or
  // reused / existing after an earlier run failed here. The body goes on stdin, not a temp file,
  // because a Windows gh.exe run from WSL cannot read a Linux temp path.
  for (const m of Object.values(made)) {
    const body = resolveBody(m.body, made);
    if (body !== null) gh(['api', '-X', 'PATCH', `repos/${m.repo}/issues/${m.number}`, '--input', '-'], JSON.stringify({ body }));
  }

  // 5. Native sub-issue links (skipped when already linked).
  for (const e of entries.filter((x) => x.parent)) {
    const p = made[e.parent];
    const existing = api(['--paginate', '--slurp', `repos/${p.repo}/issues/${p.number}/sub_issues?per_page=100`]).flat().map((s) => s.id);
    if (!existing.includes(made[e.key].id)) api(['-X', 'POST', `repos/${p.repo}/issues/${p.number}/sub_issues`, '-F', `sub_issue_id=${made[e.key].id}`]);
  }

  // 6. The board.
  const profile = readProfile();
  if (profile.board) {
    const board = openBoard(profile.board);
    for (const e of entries)
      setItems(board, profile, [made[e.key].url], {
        status: e !== plan.parent && !e.depends?.length ? 'Ready' : 'Backlog',
        size: e.size, platform: e.platform, release: plan.release,
      });
  }

  for (const [key, m] of Object.entries(made)) console.log(`${key}\t${m.how}\t${m.url}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

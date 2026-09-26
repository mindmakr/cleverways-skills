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
//   "items": [ { "key": "T1", "repo": "owner/repo", "title": "…", "body": "…", "labels": ["task"], "parent": "P" } ]
// }
// Bodies may reference other entries as {{T1}}; they become owner/repo#n after creation.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const planPath = argv[argv.indexOf('--plan') + 1];
const dry = argv.includes('--dry');
if (!argv.includes('--plan') || !planPath) { console.error('Usage: plan-to-github.mjs --plan plan.json [--dry]'); process.exit(2); }
const plan = JSON.parse(readFileSync(planPath, 'utf8'));
const entries = [plan.parent, ...plan.items].filter(Boolean);

const COLORS = { epic: '3E4B9E', feature: '1D76DB', replace: 'D93F0B', refactor: '5319E7', task: 'C5DEF5' };
const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 1 << 26 });
const api = (args) => JSON.parse(gh(['api', ...args]) || 'null');

if (dry) {
  const repos = [...new Set(entries.map((e) => e.repo))];
  console.log(`Milestone: ${plan.milestone?.title ?? '(none)'} in ${repos.join(', ')}`);
  for (const e of entries) console.log(`${e.key.padEnd(5)} ${e.repo} ${e.number ? `#${e.number} (existing)` : e.title}  [${(e.labels ?? []).join(', ')}]${e.parent ? `  ← sub-issue of ${e.parent}` : ''}`);
  process.exit(0);
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
    made[e.key] = { repo: e.repo, number: i.number, id: i.id, url: i.html_url, how: 'existing' };
    continue;
  }
  const hits = JSON.parse(gh(['issue', 'list', '-R', e.repo, '--state', 'all', '--search', `in:title "${e.title}"`, '--json', 'number,title,url', '--limit', '20']));
  const same = hits.find((h) => h.title === e.title);
  if (same) {
    const i = api([`repos/${e.repo}/issues/${same.number}`]);
    made[e.key] = { repo: e.repo, number: i.number, id: i.id, url: i.html_url, how: 'reused' };
    continue;
  }
  const i = api(['-X', 'POST', `repos/${e.repo}/issues`, '-f', `title=${e.title}`, '-f', `body=${e.body ?? ''}`,
    ...(e.labels ?? []).flatMap((l) => ['-f', `labels[]=${l}`]),
    ...(milestone[e.repo] ? ['-F', `milestone=${milestone[e.repo]}`] : [])]);
  made[e.key] = { repo: e.repo, number: i.number, id: i.id, url: i.html_url, how: 'created' };
}

// 4. Resolve {{KEY}} references in bodies of issues created now.
const ref = (k) => (made[k] ? `${made[k].repo}#${made[k].number}` : `{{${k}}}`);
for (const e of entries) {
  if (made[e.key].how !== 'created' || !/\{\{\w+\}\}/.test(e.body ?? '')) continue;
  const file = join(tmpdir(), `plan-body-${e.key}.md`);
  writeFileSync(file, e.body.replace(/\{\{(\w+)\}\}/g, (_, k) => ref(k)));
  gh(['api', '-X', 'PATCH', `repos/${e.repo}/issues/${made[e.key].number}`, '-F', `body=@${file}`]);
}

// 5. Native sub-issue links (skipped when already linked).
for (const e of entries.filter((x) => x.parent)) {
  const p = made[e.parent];
  const existing = api(['--paginate', '--slurp', `repos/${p.repo}/issues/${p.number}/sub_issues?per_page=100`]).flat().map((s) => s.id);
  if (!existing.includes(made[e.key].id)) api(['-X', 'POST', `repos/${p.repo}/issues/${p.number}/sub_issues`, '-F', `sub_issue_id=${made[e.key].id}`]);
}

for (const [key, m] of Object.entries(made)) console.log(`${key}\t${m.how}\t${m.url}`);

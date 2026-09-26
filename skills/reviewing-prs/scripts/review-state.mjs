#!/usr/bin/env node
// Reads and writes the review state kept in ONE tracking comment on a PR.
// The comment shows a human table and carries the machine state as hidden JSON,
// so any agent in any session can resume the review where the last one stopped.
//
// Usage:
//   node review-state.mjs get <pr> [--repo owner/repo]                 prints { commentId, state }
//   node review-state.mjs put <pr> --file state.json [--repo owner/repo] [--dry]  creates or updates the comment (--dry prints it)
//
// State: { pr, round, reviewedSha, issues: [n], verdict, blockedOn,
//          findings: [{ id, fp, severity, status, summary, where, round }],
//          questions: [{ id, text, status, answer }] }
// Finding status: open | fixed | wontfix | invalid.  Question status: open | answered.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MARK = '<!-- cleverways:pr-review -->';
const [cmd, pr, ...rest] = process.argv.slice(2);
const opt = (name) => { const i = rest.indexOf(`--${name}`); return i === -1 ? null : rest[i + 1]; };
if (!['get', 'put'].includes(cmd) || !pr) {
  console.error('Usage: review-state.mjs get|put <pr> [--file state.json] [--repo owner/repo]');
  process.exit(2);
}
const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 1 << 26 });
const repo = opt('repo') ?? gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']).trim();

function find() {
  const comments = JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repo}/issues/${pr}/comments`])).flat();
  const c = comments.find((x) => x.body?.includes(MARK));
  if (!c) return { commentId: null, state: { pr: Number(pr), round: 0, reviewedSha: null, issues: [], verdict: null, blockedOn: null, findings: [], questions: [] } };
  const json = c.body.match(/<!-- state\n([\s\S]*?)\n-->/)?.[1];
  return { commentId: c.id, state: JSON.parse(json) };
}

function render(s) {
  const open = s.findings.filter((f) => f.status === 'open');
  const qs = s.questions.filter((q) => q.status === 'open');
  const row = (f) => `| ${f.id} | ${f.severity} | ${f.status} | ${f.summary} | ${f.where ?? ''} | R${f.round} |`;
  return [
    MARK,
    `## Review tracker: ${s.verdict ?? 'IN REVIEW'}`,
    '',
    `Round ${s.round} · reviewed \`${(s.reviewedSha ?? '').slice(0, 7)}\`${s.issues.length ? ` · covers ${s.issues.map((n) => `#${n}`).join(', ')}` : ''}${s.blockedOn ? ` · **waiting on ${s.blockedOn}**` : ''}`,
    `Open: ${open.length} finding(s), ${qs.length} question(s).`,
    '',
    '| ID | Severity | Status | Finding | Where | Found |',
    '|---|---|---|---|---|---|',
    ...s.findings.map(row),
    ...(s.questions.length ? ['', '### Questions', ...s.questions.map((q) => `- **${q.id}** (${q.status}): ${q.text}${q.answer ? ` → ${q.answer}` : ''}`)] : []),
    '',
    '<sub>Updated by the reviewing-prs skill. Reply on the inline comment for a finding; the next round re-checks it.</sub>',
    '',
    `<!-- state\n${JSON.stringify(s)}\n-->`,
  ].join('\n');
}

if (cmd === 'get') {
  console.log(JSON.stringify(find(), null, 2));
} else {
  const state = JSON.parse(readFileSync(opt('file') ?? '', 'utf8'));
  if (rest.includes('--dry')) { console.log(render(state)); process.exit(0); }
  const { commentId } = find();
  const bodyFile = join(tmpdir(), `pr-review-${pr}.md`);
  writeFileSync(bodyFile, render(state));
  const res = commentId
    ? gh(['api', '-X', 'PATCH', `repos/${repo}/issues/comments/${commentId}`, '-F', `body=@${bodyFile}`, '-q', '.html_url'])
    : gh(['api', '-X', 'POST', `repos/${repo}/issues/${pr}/comments`, '-F', `body=@${bodyFile}`, '-q', '.html_url']);
  console.log(res.trim());
}

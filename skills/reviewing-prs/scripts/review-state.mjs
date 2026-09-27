#!/usr/bin/env node
// Reads and writes the review state kept in ONE tracking comment on a PR.
// The comment shows a human table and carries the machine state as hidden JSON,
// so any agent in any session can resume the review where the last one stopped.
//
// Usage:
//   node review-state.mjs get <pr> [--repo owner/repo]                 prints { commentId, state }
//   node review-state.mjs issues <pr> [--repo owner/repo]              prints linked issue numbers
//   node review-state.mjs resolve <pr> [--repo owner/repo]             resolves inline threads of fixed findings
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
if (!['get', 'put', 'issues', 'resolve'].includes(cmd) || !pr) {
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

if (cmd === 'resolve') {
  // Tidies the PR after a round, so the conversation shows only what is still open:
  //  - resolves the inline thread of every finding that is `fixed` or `invalid`
  //    (a thread belongs to a finding when its first comment starts with "**R<n> ·");
  //  - hides review bodies from earlier rounds as OUTDATED ("<!-- cleverways:review-round:<n> -->");
  //  - keeps the latest round review visible (the verdict at the bottom of the PR);
  //  - once no finding is open, hides earlier round reviews and every fix note
  //    ("<!-- cleverways:fix-note -->") as RESOLVED. The tracker comment is never hidden.
  const [owner, name] = repo.split('/');
  const q = 'query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){'
    + 'reviewThreads(first:100){nodes{id isResolved comments(first:1){nodes{body}}}} '
    + 'reviews(first:100){nodes{id isMinimized body}} comments(first:100){nodes{id isMinimized body}}}}}';
  const p = JSON.parse(gh(['api', 'graphql', '-f', `query=${q}`, '-F', `o=${owner}`, '-F', `r=${name}`, '-F', `n=${pr}`])).data.repository.pullRequest;
  const { state } = find();
  const done = new Set(state.findings.filter((f) => ['fixed', 'invalid'].includes(f.status)).map((f) => f.id));
  const allDone = state.findings.every((f) => f.status !== 'open');
  const run = (mutation, id) => gh(['api', 'graphql', '-f', `query=${mutation}`, '-F', `s=${id}`]);
  const hide = (id, why) => run(`mutation($s:ID!){minimizeComment(input:{subjectId:$s,classifier:${why}}){minimizedComment{isMinimized}}}`, id);

  for (const t of p.reviewThreads.nodes) {
    // The finding id opens the inline comment in bold: "**R5 · …", "**R5 (low)…", "**R5** …" or "**R5:".
    const id = t.comments.nodes[0]?.body.match(/^\*\*(R\d+)\b/)?.[1];
    if (!id || t.isResolved || !done.has(id)) continue;
    run('mutation($s:ID!){resolveReviewThread(input:{threadId:$s}){thread{isResolved}}}', t.id);
    console.log(`resolved thread ${id}`);
  }
  for (const r of p.reviews.nodes) {
    const round = Number(r.body?.match(/<!-- cleverways:review-round:(\d+) -->/)?.[1]);
    // The latest round's review stays visible: it is the verdict at the bottom of the conversation.
    if (!round || r.isMinimized || round >= state.round) continue;
    hide(r.id, allDone ? 'RESOLVED' : 'OUTDATED');
    console.log(`hid round ${round} review`);
  }
  if (allDone) {
    for (const c of p.comments.nodes) {
      if (c.isMinimized || !c.body?.includes('<!-- cleverways:fix-note -->')) continue;
      hide(c.id, 'RESOLVED');
      console.log('hid fix note');
    }
  }
} else if (cmd === 'issues') {
  // Linked issues: GitHub's closing references (GraphQL; not every gh version exposes them
  // in `gh pr view --json`) plus any #n written in the PR body.
  const [owner, name] = repo.split('/');
  const q = 'query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){body closingIssuesReferences(first:50){nodes{number}}}}}';
  const data = JSON.parse(gh(['api', 'graphql', '-f', `query=${q}`, '-F', `o=${owner}`, '-F', `r=${name}`, '-F', `n=${pr}`]));
  const p = data.data.repository.pullRequest;
  const nums = new Set(p.closingIssuesReferences.nodes.map((x) => x.number));
  for (const m of (p.body ?? '').matchAll(/(?:^|[\s(])#(\d+)\b/g)) if (Number(m[1]) !== Number(pr)) nums.add(Number(m[1]));
  console.log(JSON.stringify([...nums].sort((a, b) => a - b)));
} else if (cmd === 'get') {
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

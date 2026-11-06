#!/usr/bin/env node
// Reads and writes the review state kept in ONE tracking comment on a PR.
// The comment shows a human table and carries the machine state as hidden JSON,
// so any agent in any session can resume the review where the last one stopped.
//
// Usage:
//   node review-state.mjs get <pr> [--repo owner/repo]                 prints { commentId, state }
//   node review-state.mjs issues <pr> [--repo owner/repo]              prints linked issue numbers
//   node review-state.mjs resolve <pr> [--repo owner/repo]             resolves inline threads of fixed findings
//   node review-state.mjs put <pr> --file state.json [--repo owner/repo] [--dry [--stored old.json]]
//                                creates or updates the comment (--dry prints it; --stored stands in for the comment)
//   node review-state.mjs scope <pr> [--final] [--head sha] [--base ref] [--state state.json] [--repo owner/repo]
//                                prints what the next round reviews, and how
//   --fixture <file> ({ comments, reviews } as the GitHub API returns them) stands in for GitHub in tests.
//
// Round cap: a PR gets four rounds, and only the person can allow more. `scope` exits 5 when the
// next round is past the cap and lists the open items; the verdict is then BLOCKED ON user. `put`
// refuses (exit 5) a state whose round is not a whole number, is past the cap, or is below the
// stored round. The stored round is never below the highest round review on the PR
// ("<!-- cleverways:review-round:<n> -->"; GitHub keeps submitted reviews), so deleting the
// tracker does not reset it. `extraRounds: n` (1 to 4) on an answered question raises the cap by
// n only with `answerComment: <id>`: a PR comment written after the question was put on the
// tracker (`askedAt`, stamped by this script), naming the question id and the number, and not
// written by these skills (no "<!-- cleverways" marker). An agent cannot grant rounds by
// answering its own question; it would have to post a comment as the person, in plain sight.
//
// State: { pr, round, reviewedSha, issues: [n], verdict, blockedOn,
//          findings: [{ id, fp, severity, status, summary, where, round }],
//          questions: [{ id, text, status, answer, askedAt, extraRounds, answerComment }],
//          checks: { where: 'ci' | 'local', command, sha, result } }   (checks is optional)
// Finding status: open | fixed | wontfix | invalid.  Question status: open | answered.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MARK = '<!-- cleverways:pr-review -->';
const [cmd, pr, ...rest] = process.argv.slice(2);
const opt = (name) => { const i = rest.indexOf(`--${name}`); return i === -1 ? null : rest[i + 1]; };
if (!['get', 'put', 'issues', 'resolve', 'scope'].includes(cmd) || !pr) {
  console.error('Usage: review-state.mjs get|put|issues|resolve|scope <pr> [--file state.json] [--repo owner/repo]');
  process.exit(2);
}
const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 1 << 26 });
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
let repoName = opt('repo');
const repoOf = () => (repoName ??= gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']).trim());

const CAP = 4;
const MAX_EXTRA = 4;
const validExtra = (n) => Number.isInteger(n) && n >= 1 && n <= MAX_EXTRA;
const capOf = (s) => CAP + (s.questions ?? [])
  .filter((q) => q.status === 'answered' && validExtra(q.extraRounds))
  .reduce((n, q) => n + q.extraRounds, 0);
const refuse = (why) => { console.error(why); process.exit(5); };
// The highest round review on the PR: a floor for the round that survives a deleted tracker.
const reviewFloor = (reviews) => Math.max(0, ...reviews.map((x) => Number(x.body?.match(/<!-- cleverways:review-round:(\d+) -->/)?.[1]) || 0));
function checkPut(next, stored, { comments, reviews }, now) {
  const prev = stored ?? { round: 0, questions: [] };
  const floor = Math.max(prev.round ?? 0, reviewFloor(reviews));
  if (!Number.isInteger(next.round) || next.round < 1) refuse(`round must be a whole number of at least 1, not ${JSON.stringify(next.round)}.`);
  if (next.round < floor) refuse(`Round ${next.round} is lower than round ${floor}, already stored or reviewed on the PR; a round number never goes back.`);
  for (const q of next.questions ?? []) {
    const before = (prev.questions ?? []).find((x) => x.id === q.id);
    q.askedAt = before?.askedAt ?? now; // stamped here, never taken from the caller
    if (q.extraRounds === undefined || q.extraRounds === null) continue;
    if (!validExtra(q.extraRounds)) refuse(`${q.id}: extraRounds must be a whole number from 1 to ${MAX_EXTRA}, not ${JSON.stringify(q.extraRounds)}.`);
    if (before?.status === 'answered' && before.extraRounds === q.extraRounds && before.answerComment === q.answerComment) continue;
    if (before?.status !== 'open' || q.status !== 'answered') refuse(`${q.id}: extraRounds can only be set when the person answers a question the tracker already holds open.`);
    const c = comments.find((x) => String(x.id) === String(q.answerComment));
    const ok = c && !c.body?.includes('<!-- cleverways') && Date.parse(c.created_at) > Date.parse(before.askedAt)
      && new RegExp(`\\b${q.id}\\b`).test(c.body) && new RegExp(`\\b${q.extraRounds}\\b`).test(c.body);
    if (!ok) refuse(`${q.id}: extraRounds needs answerComment, the id of the person's PR comment written after the question was asked, naming ${q.id} and ${q.extraRounds}. Ask the person to reply on the PR.`);
  }
  if (next.round > capOf(next)) refuseOverCap(next, next.round);
}
function refuseOverCap(s, round) {
  console.error(`Round ${round} is past this PR's cap of ${capOf(s)} rounds. Set the verdict to BLOCKED ON user, `
    + 'list the open items, and ask whether to allow more rounds (record the answer with extraRounds). Open items:');
  for (const f of s.findings.filter((x) => x.status === 'open')) console.error(`- ${f.id} (${f.severity}) ${f.summary}`);
  for (const q of (s.questions ?? []).filter((x) => x.status === 'open')) console.error(`- ${q.id} (question) ${q.text}`);
  process.exit(5);
}

// Paths whose change makes a follow-up round run the security scan and security review again.
// Generic on purpose: auth, sessions, permissions and roles, routes, queries, env and config,
// secrets, CI workflows, container files, dependency manifests and lockfiles.
const SEP = '(^|[/._-])', END = '([/._-]|$)';
const SECURITY = [
  new RegExp(`${SEP}(auth\\w*|login|logout|sign-?in|sign-?up|sessions?|tokens?|jwt|oauth|sso|otp|mfa|passwords?|credentials?|crypto|secrets?|keys?)${END}`, 'i'),
  new RegExp(`${SEP}(permissions?|roles?|rbac|acl|polic(y|ies)|guards?|middlewares?|access)${END}`, 'i'),
  new RegExp(`${SEP}(routes?|router|controllers?|handlers?|endpoints?|api|webhooks?|uploads?)${END}`, 'i'),
  new RegExp(`${SEP}(sql|quer(y|ies)|repositor(y|ies)|migrations?)${END}|\\.sql$`, 'i'),
  new RegExp(`(^|/)\\.env|${SEP}(env|config|settings)${END}`, 'i'),
  /^\.github\/workflows\/|(^|\/)(Dockerfile|docker-compose[^/]*|compose\.ya?ml)$/i,
  /(^|\/)(package(-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|requirements[^/]*\.txt|pyproject\.toml|poetry\.lock|Pipfile(\.lock)?|go\.(mod|sum)|Cargo\.(toml|lock)|Gemfile(\.lock)?|composer\.(json|lock)|pom\.xml|build\.gradle(\.kts)?)$/i,
];
const securityRelevant = (path) => SECURITY.some((re) => re.test(path));

let factsCache;
function facts() {
  if (factsCache) return factsCache;
  if (opt('fixture') || rest.includes('--dry')) {
    return (factsCache = { comments: [], reviews: [], ...(opt('fixture') ? JSON.parse(readFileSync(opt('fixture'), 'utf8')) : {}) });
  }
  const list = (path) => JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repoOf()}/${path}`])).flat();
  return (factsCache = { comments: list(`issues/${pr}/comments`), reviews: list(`pulls/${pr}/reviews`) });
}
function find() {
  const { comments, reviews } = facts();
  const c = comments.find((x) => x.body?.includes(MARK));
  const floor = reviewFloor(reviews);
  if (!c) return { commentId: null, state: { pr: Number(pr), round: floor, reviewedSha: null, issues: [], verdict: null, blockedOn: null, findings: [], questions: [] } };
  const json = c.body.match(/<!-- state\n([\s\S]*?)\n-->/)?.[1];
  const state = JSON.parse(json);
  return { commentId: c.id, state: { ...state, round: Math.max(Number.isInteger(state.round) ? state.round : 0, floor) } };
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
    ...(s.checks ? [`Checks (${s.checks.where}): ${s.checks.command ? `\`${s.checks.command}\` ` : ''}on \`${(s.checks.sha ?? '').slice(0, 7)}\`: ${s.checks.result}`] : []),
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
  const [owner, name] = repoOf().split('/');
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
  const [owner, name] = repoOf().split('/');
  const q = 'query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){body closingIssuesReferences(first:50){nodes{number}}}}}';
  const data = JSON.parse(gh(['api', 'graphql', '-f', `query=${q}`, '-F', `o=${owner}`, '-F', `r=${name}`, '-F', `n=${pr}`]));
  const p = data.data.repository.pullRequest;
  const nums = new Set(p.closingIssuesReferences.nodes.map((x) => x.number));
  for (const m of (p.body ?? '').matchAll(/(?:^|[\s(])#(\d+)\b/g)) if (Number(m[1]) !== Number(pr)) nums.add(Number(m[1]));
  console.log(JSON.stringify([...nums].sort((a, b) => a - b)));
} else if (cmd === 'scope') {
  // What the next round reviews, and how. Every review runs at high effort.
  //  - round 1: the whole PR, with the security scan and security review;
  //  - later rounds: only reviewedSha..head; security again only when that range touches a
  //    security-relevant path (a rebase that drops reviewedSha means the whole PR again);
  //  - --final: the whole PR once more, run by a follow-up round about to say READY, so code
  //    no range showed again is still read at the end. No security: round 1 had it.
  // `prepare` makes a worktree at head (unique per head) that reviewers read by path, never by cd.
  // A skill runs in the session's directory and cannot be pointed at a worktree, so the code-review
  // skill is named only for a whole-PR pass when the session's checkout is already at head. Every
  // other review is one subagent with reviewer-brief.md, `dir` and `diff`.
  const atHead = (sha) => { try { return git('rev-parse', 'HEAD').trim() === sha; } catch { return false; } };
  const state = opt('state') ? JSON.parse(readFileSync(opt('state'), 'utf8')) : find().state;
  if (!Number.isInteger(state.round) || state.round < 0) refuse(`The stored round is ${JSON.stringify(state.round)}, not a whole number.`);
  if (opt('state') && opt('fixture')) state.round = Math.max(state.round, reviewFloor(facts().reviews));
  const round = state.round + 1;
  if (round > capOf(state)) refuseOverCap(state, round);
  const final = rest.includes('--final');
  let head = opt('head'), base = opt('base');
  if (!head || !base) {
    const info = JSON.parse(gh(['pr', 'view', pr, '--repo', repoOf(), '--json', 'headRefOid,baseRefName']));
    git('fetch', '-q', 'origin', info.baseRefName, `pull/${pr}/head`);
    head ??= info.headRefOid;
    base ??= `origin/${info.baseRefName}`;
  }
  const from = state.reviewedSha;
  if (from === head && !final) { console.log(JSON.stringify({ round: state.round, head, same: true })); process.exit(0); }
  let ancestor = false;
  if (from && !final) { try { git('merge-base', '--is-ancestor', from, head); ancestor = true; } catch { /* rebased */ } }
  const start = ancestor ? from : git('merge-base', base, head).trim();
  const files = git('diff', '--name-only', '--no-renames', start, head).split('\n').filter(Boolean);
  const securityFiles = files.filter(securityRelevant);
  const dir = (opt('dir') ?? join(tmpdir(), `review-${pr}-${head.slice(0, 7)}`)).replace(/\\/g, '/');
  const mode = final ? 'final' : ancestor ? 'range' : 'full';
  console.log(JSON.stringify({
    round, cap: capOf(state), mode, range: `${start}..${head}`, head, files: files.length,
    security: !final && (!from || securityFiles.length > 0),
    securityFiles,
    dir,
    prepare: `git worktree add --detach "${dir}" ${head}`,
    diff: `git -C "${dir}" diff ${start}..${head}`,
    correctness: mode !== 'range' && atHead(head) ? `code-review high ${pr}` : 'subagent: reviewer-brief.md, dir, diff',
    cleanup: `git worktree remove --force "${dir}"`,
  }, null, 2));
} else if (cmd === 'get') {
  console.log(JSON.stringify(find(), null, 2));
} else {
  const state = JSON.parse(readFileSync(opt('file') ?? '', 'utf8'));
  if (rest.includes('--dry')) {
    checkPut(state, opt('stored') ? JSON.parse(readFileSync(opt('stored'), 'utf8')) : null, facts(), opt('now') ?? new Date().toISOString());
    console.log(render(state));
    process.exit(0);
  }
  const { commentId, state: stored } = find();
  checkPut(state, commentId ? stored : null, facts(), new Date().toISOString());
  const bodyFile = join(tmpdir(), `pr-review-${pr}.md`);
  writeFileSync(bodyFile, render(state));
  const res = commentId
    ? gh(['api', '-X', 'PATCH', `repos/${repoOf()}/issues/comments/${commentId}`, '-F', `body=@${bodyFile}`, '-q', '.html_url'])
    : gh(['api', '-X', 'POST', `repos/${repoOf()}/issues/${pr}/comments`, '-F', `body=@${bodyFile}`, '-q', '.html_url']);
  console.log(res.trim());
}

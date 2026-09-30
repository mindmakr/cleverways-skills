#!/usr/bin/env node
// The data every running-scrum ritual starts from. Read-only: it never changes the board.
//
// Usage:
//   scrum.mjs report [--out report.json]   the board, open PRs and sprint numbers, with flags
//   scrum.mjs rank                         open issues in the order to work them, with reasons
//   scrum.mjs stale <ref>                  has the code an issue cites changed since its evidence?
//   common: [--board <project URL>] [--profile <path to project-profile.md>]
//
// Flags per item: stuck, unassigned, conflict, checks-failing, review-behind-head, abandoned,
// not-started. Thresholds come from the profile's Tracking line "Thresholds: stuck 3d, stale 30d,
// abandoned 30d" (these are the defaults).

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BOARD = join(dirname(fileURLToPath(import.meta.url)), '../../setting-up-project-tracking/scripts/board.mjs');
const { endOf, iteration, openBoard, readProfile, reviewState, short } = await import(pathToFileURL(BOARD).href);

const DAY = 864e5;
const ACTIVE = ['In progress', 'In review', 'Ready to merge', 'On test'];
const age = (iso, now) => (now - Date.parse(iso)) / DAY;
const itsOf = (its) => ({ field: (n) => (n === 'Sprint' ? { configuration: { iterations: its } } : undefined) });

// ---------- pure ----------

export function toItem(it, health, review) {
  const c = it.content, isPr = c.__typename === 'PullRequest';
  const rollup = health?.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state;
  const checks = !rollup ? 'none' : rollup === 'SUCCESS' ? 'pass' : ['FAILURE', 'ERROR'].includes(rollup) ? 'fail' : 'pending';
  const item = {
    ref: short(c.url), url: c.url, type: isPr ? 'pr' : 'issue', title: c.title, state: c.state,
    status: it.status?.name ?? null, statusSince: it.updatedAt ?? c.updatedAt,
    sprint: it.sprint?.title ?? null, release: it.release?.name ?? null, priority: it.priority?.name ?? null, size: it.size?.name ?? null,
    assignees: (c.assignees?.nodes ?? []).map((a) => a.login), labels: (c.labels?.nodes ?? []).map((l) => l.name),
    createdAt: c.createdAt, updatedAt: c.updatedAt, blocking: c.issueDependenciesSummary?.blocking ?? 0,
    linkedPrs: it.prText?.text ?? '', fixes: it.fixesText?.text ?? '',
  };
  if (isPr && health) {
    const author = health.author?.login ?? null;
    item.pr = {
      mergeable: health.mergeable, checks, headSha: health.headRefOid, reviewedSha: review?.reviewedSha ?? null,
      verdict: review?.verdict ?? null, author, isDependabot: /dependabot/i.test(author ?? ''), isDraft: health.isDraft,
    };
  }
  return item;
}

export function flagsFor(item, { now, thresholds, sprint }) {
  if (item.state !== 'OPEN') return [];
  const f = [];
  const inSprint = sprint && item.sprint === sprint.title;
  if (ACTIVE.includes(item.status) && age(item.statusSince, now) > thresholds.stuck) f.push('stuck');
  if (item.type === 'issue' && !item.assignees.length && (['In progress', 'In review', 'Ready to merge'].includes(item.status) || inSprint)) f.push('unassigned');
  if (item.pr) {
    if (item.pr.mergeable === 'CONFLICTING') f.push('conflict');
    if (item.pr.checks === 'fail') f.push('checks-failing');
    if (!item.pr.isDraft && item.pr.reviewedSha !== item.pr.headSha) f.push('review-behind-head');
    if (age(item.updatedAt, now) > thresholds.abandoned) f.push('abandoned');
  }
  const elapsed = sprint ? (now - Date.parse(`${sprint.startDate}T00:00:00Z`)) / (sprint.duration * DAY) : 0;
  if (item.type === 'issue' && inSprint && [null, 'Backlog', 'Ready'].includes(item.status) && elapsed >= 0.5) f.push('not-started');
  return f;
}

const PRIORITY = { High: 0, Medium: 1, Low: 2 };
export function rank(items, releaseOrder) {
  const key = (i) => {
    const rel = releaseOrder.indexOf(i.release);
    const security = i.labels.some((l) => /security/i.test(l));
    return [rel < 0 ? releaseOrder.length : rel, /\bopen\b/.test(i.linkedPrs) ? 0 : 1, security || i.priority === 'High' ? 0 : 1,
      i.blocking > 0 ? 0 : 1, PRIORITY[i.priority] ?? 3, Date.parse(i.createdAt), i.ref];
  };
  const reason = (i) => [i.release ?? 'no release', /\bopen\b/.test(i.linkedPrs) && `has PR (${i.linkedPrs})`,
    i.labels.some((l) => /security/i.test(l)) && 'security', i.priority ?? 'no priority', i.blocking > 0 && `blocks ${i.blocking}`,
    `opened ${i.createdAt.slice(0, 10)}`].filter(Boolean).join(' · ');
  const cmp = (a, b) => { for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1; return 0; };
  return items.filter((i) => i.type === 'issue' && i.state === 'OPEN' && i.status !== 'Done')
    .map((i) => ({ i, k: key(i) })).sort((a, b) => cmp(a.k, b.k)).map(({ i }) => ({ ...i, reason: reason(i) }));
}

export function sprintStats(items, iterations, now) {
  const current = iteration(itsOf(iterations), 'current', now) ?? null;
  const prev = current && [...iterations].filter((i) => endOf(i) <= current.startDate).sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0];
  const issues = items.filter((i) => i.type === 'issue');
  const inCur = current ? issues.filter((i) => i.sprint === current.title) : [];
  const count = (s) => inCur.filter((i) => i.status === s).length;
  return {
    current, planned: inCur.length, done: count('Done'), onTest: count('On test'), inProgress: count('In progress'),
    previous: prev?.title ?? null, previousDone: prev ? issues.filter((i) => i.sprint === prev.title && i.status === 'Done').length : 0,
  };
}

// ---------- GitHub ----------

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 1 << 26 }).trim();

function prHealth(repo) {
  const [owner, name] = repo.split('/');
  const q = `query($o:String!,$n:String!){repository(owner:$o,name:$n){pullRequests(states:OPEN,first:100){nodes{
    url mergeable isDraft headRefOid author{login} commits(last:1){nodes{commit{statusCheckRollup{state}}}}}}}}`;
  const out = JSON.parse(gh(['api', 'graphql', '-f', `query=${q}`, '-f', `o=${owner}`, '-f', `n=${name}`]));
  return out.data.repository.pullRequests.nodes;
}

export function buildReport(profile, url, now = Date.now()) {
  const board = openBoard(url);
  const conf = board.field('Sprint')?.configuration;
  const iterations = [...(conf?.iterations ?? []), ...(conf?.completedIterations ?? [])];
  const current = iteration(board, 'current', now) ?? null;
  const health = new Map(), errors = [];
  for (const repo of profile.repos) {
    try { for (const p of prHealth(repo)) health.set(p.url, p); } catch (e) { errors.push(`${repo}: open PRs not read (${e.message.split('\n')[0]})`); }
  }
  const keep = (it) => it.content?.state === 'OPEN' || [current?.title, sprintStats([], iterations, now).previous].includes(it.sprint?.title);
  const items = [];
  for (const it of board.items.values()) {
    if (!it.content?.url || !keep(it)) continue;
    const h = health.get(it.content.url);
    let review = null;
    const unknown = [];
    if (h) { try { review = reviewState(it.content.repository.nameWithOwner, it.content.number); } catch { unknown.push('review'); } }
    else if (it.content.__typename === 'PullRequest' && it.content.state === 'OPEN') unknown.push('pr');
    const item = toItem(it, h, review);
    item.flags = flagsFor(item, { now, thresholds: profile.thresholds, sprint: current });
    if (unknown.length) item.unknown = unknown;
    items.push(item);
  }
  for (const [u] of health) if (!board.items.has(u)) errors.push(`${short(u)}: open PR not on the board (board.mjs sync adds it)`);
  return {
    generatedAt: new Date(now).toISOString(), board: { url, title: board.title, currentSprint: current },
    releaseOrder: (board.field('Release')?.options ?? []).map((o) => o.name),
    owners: profile.owners, thresholds: profile.thresholds,
    sprint: sprintStats(items, iterations, now), items, errors,
  };
}

// ---------- CLI ----------

async function main() {
  const [cmd, ...argv] = process.argv.slice(2);
  const flags = {}, refs = [];
  for (let i = 0; i < argv.length; i++) argv[i].startsWith('--') ? (flags[argv[i].slice(2)] = argv[++i]) : refs.push(argv[i]);
  const profile = readProfile(flags.profile);
  const url = flags.board ?? profile.board;
  if (!['report', 'rank', 'stale'].includes(cmd) || (cmd === 'stale' && !refs.length)) {
    console.error('Usage: scrum.mjs report|rank|stale <ref> … (see the header of this file)');
    process.exit(2);
  }
  if (!url) { console.log('No board: the profile has no "Board:" line in its Tracking section.'); return; }
  if (cmd === 'report') {
    const json = JSON.stringify(buildReport(profile, url), null, 1);
    if (flags.out) { writeFileSync(flags.out, json); console.log(`Report written to ${flags.out}`); } else console.log(json);
  } else if (cmd === 'rank') {
    const r = buildReport(profile, url);
    rank(r.items, r.releaseOrder).forEach((i, n) => console.log(`${n + 1}. ${i.ref}  ${i.status ?? 'no status'}  ${i.title}\n   ${i.reason}`));
  } else {
    const { staleReport } = await import('./stale.mjs');
    console.log(JSON.stringify(staleReport(profile, refs[0]), null, 1));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

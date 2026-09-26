#!/usr/bin/env node
// Keeps the GitHub Project board in step with the work. The skills call it at the moment they
// change an issue or PR, and `sync` repairs anything people changed by hand, so the board shows
// what is true now. The board is the profile's Tracking line "Board: <project URL>", or --board.
// With no board configured it prints a note and exits 0, so callers never need to check first.
//
// Usage:
//   board.mjs set <ref> [<ref> …] [--status S] [--sprint current|next|<title>] [--release R]
//                 [--priority High|Medium|Low] [--size S] [--platform P]
//   board.mjs show <ref>
//   board.mjs list [--release R] [--status "On test,Done"] [--json]
//   board.mjs sync [--close-merged] [--dry]
//   common: [--board <project URL>] [--profile <path to project-profile.md>]
//
// <ref> is owner/repo#n or an issue URL. `set` adds the item when it is missing and, on add,
// takes Priority from the labels and Platform from the profile when neither is given.
//
// GitHub links a PR to its issue by closing keyword only when the PR targets the default
// branch. PRs based elsewhere (test, develop) never fill "Linked pull requests", so `sync` reads
// the keywords from PR bodies itself (Fixes / Closes / Resolves / Refs / Part of <ref>) and
// writes the link into two text fields it creates when missing: "Pull request" on each issue
// (e.g. "#575 open · #48 merged") and "Fixes" on each PR. Open PRs go on the board as their own
// items, In review, with no Sprint, so the sprint board shows only issues. A PR approved on its
// latest commit, or given READY TO MERGE by reviewing-prs on it, moves to Ready to merge with its issues.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const gh = (args, input) => execFileSync('gh', args, { encoding: 'utf8', input, maxBuffer: 1 << 26 }).trim();
const gql = (query, vars = {}) =>
  JSON.parse(gh(['api', 'graphql', '--input', '-'], JSON.stringify({ query, variables: vars }))).data;

// ---------- profile ----------

export function readProfile(path) {
  let p = path;
  if (!p) {
    let dir = process.cwd();
    for (;;) {
      if (existsSync(join(dir, '.agents/project-profile.md'))) { p = join(dir, '.agents/project-profile.md'); break; }
      const up = dirname(dir);
      if (up === dir) return {};
      dir = up;
    }
  }
  const text = readFileSync(p, 'utf8');
  const shared = text.match(/^Shared:\s*(\S+)/m)?.[1];
  const sharedPath = shared && resolve(dirname(p), '..', shared);
  const base = sharedPath && existsSync(sharedPath) ? readProfile(sharedPath) : {};
  const section = (name) => text.split(/^## /m).find((s) => s.startsWith(name)) ?? '';
  const repos = [...section('Repos').matchAll(/\|\s*`?([\w.-]+\/[\w.-]+)`?\s*\|/g)].map((m) => m[1]);
  const platforms = {};
  const line = section('Tracking').match(/Platform per repo:(.*)/)?.[1] ?? '';
  for (const m of line.matchAll(/([\w.-]+)\s*→\s*(\w+)\s*(?=[,;.]|$)/g)) platforms[m[1]] = m[2];
  return {
    board: text.match(/Board:\s*<?(https:\/\/github\.com\/(?:users|orgs)\/[^/\s>]+\/projects\/\d+)/)?.[1] ?? base.board,
    repos: repos.length ? repos : base.repos ?? [],
    prBase: text.match(/PR base(?: branch)?:\s*`?([\w./-]+)`?/)?.[1] ?? base.prBase,
    platforms: Object.keys(platforms).length ? platforms : base.platforms ?? {},
  };
}

// ---------- board ----------

const ITEM = `id
  status: fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}
  release: fieldValueByName(name:"Release"){... on ProjectV2ItemFieldSingleSelectValue{name}}
  priority: fieldValueByName(name:"Priority"){... on ProjectV2ItemFieldSingleSelectValue{name}}
  sprint: fieldValueByName(name:"Sprint"){... on ProjectV2ItemFieldIterationValue{title startDate duration}}
  prText: fieldValueByName(name:"Pull request"){... on ProjectV2ItemFieldTextValue{text}}
  fixesText: fieldValueByName(name:"Fixes"){... on ProjectV2ItemFieldTextValue{text}}
  content{__typename
    ... on Issue{url number title state stateReason repository{nameWithOwner}
      assignees(first:1){totalCount} parent{url} subIssuesSummary{total completed}}
    ... on PullRequest{url number title state isDraft repository{nameWithOwner}
      reviewRequests(first:1){totalCount} reviews(first:1){totalCount}}}`;

export function openBoard(url) {
  const [, kind, login, number] = url.match(/github\.com\/(users|orgs)\/([^/]+)\/projects\/(\d+)/);
  const root = kind === 'orgs' ? 'organization' : 'user';
  const p = gql(`query($l:String!,$n:Int!){${root}(login:$l){projectV2(number:$n){id url
    fields(first:50){nodes{... on ProjectV2FieldCommon{id name dataType} ... on ProjectV2SingleSelectField{options{id name}}
      ... on ProjectV2IterationField{configuration{iterations{id title startDate duration}}}}}
    workflows(first:20){nodes{name enabled}}}}}`, { l: login, n: Number(number) })[root].projectV2;
  const field = (name) => p.fields.nodes.find((f) => f.name === name);
  const items = new Map();
  let after = null;
  do {
    const page = gql(`query($id:ID!,$a:String){node(id:$id){... on ProjectV2{items(first:100,after:$a){
      pageInfo{hasNextPage endCursor} nodes{${ITEM}}}}}}`, { id: p.id, a: after }).node.items;
    for (const it of page.nodes) if (it.content?.url) items.set(it.content.url, it);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return { ...p, field, items, login, number, kind };
}

// Creates a text field when the board lacks it. Returns false in a dry run.
function ensureTextField(board, name, dry) {
  if (board.field(name)) return true;
  if (dry) return false;
  const f = gql(`mutation{createProjectV2Field(input:{projectId:${JSON.stringify(board.id)},dataType:TEXT,name:${JSON.stringify(name)}}){
    projectV2Field{... on ProjectV2Field{id name dataType}}}}`).createProjectV2Field.projectV2Field;
  board.fields.nodes.push(f);
  return true;
}

const today = () => new Date().toISOString().slice(0, 10);
const endOf = (it) => new Date(Date.parse(`${it.startDate}T00:00:00Z`) + it.duration * 864e5).toISOString().slice(0, 10);
function iteration(board, which) {
  const its = board.field('Sprint')?.configuration?.iterations ?? [];
  if (which === 'current') return its.find((i) => i.startDate <= today() && today() < endOf(i));
  if (which === 'next') return its.find((i) => i.startDate > today());
  return its.find((i) => i.title === which);
}

export function priorityOf(labels) {
  const l = labels.map((x) => x.toLowerCase());
  const has = (...keys) => l.some((x) => keys.some((k) => x === k || x.includes(`priority: ${k}`) || x.includes(`priority/${k}`)));
  if (l.some((x) => x.includes('critical')) || has('high', 'p0', 'p1')) return 'High';
  if (has('medium', 'p2')) return 'Medium';
  if (has('low', 'p3')) return 'Low';
  return null;
}

const urlOf = (ref) => {
  if (ref.startsWith('https://')) return ref;
  const [repo, n] = ref.split('#');
  return `https://github.com/${repo}/issues/${n}`;
};
const short = (url) => url.replace('https://github.com/', '').replace(/\/(issues|pull)\//, '#');

// Returns a description of the change, or a line starting with "!" when it could not be made.
function edit(board, item, name, value) {
  const f = board.field(name);
  if (!f) return `! no ${name} field on the board`;
  let v;
  if (f.options) {
    const o = f.options.find((x) => x.name.toLowerCase() === String(value).toLowerCase());
    if (!o) return `! ${name} has no option "${value}" (options: ${f.options.map((x) => x.name).join(', ')})`;
    v = `{singleSelectOptionId:${JSON.stringify(o.id)}}`;
  } else if (f.configuration) {
    const it = iteration(board, value);
    if (!it) return `! no ${value} sprint${value === 'current' ? ' today' : ''}; Sprint left unchanged`;
    v = `{iterationId:${JSON.stringify(it.id)}}`;
    value = it.title;
  } else if (f.dataType === 'TEXT' && value === '') {
    gql(`mutation{clearProjectV2ItemFieldValue(input:{projectId:${JSON.stringify(board.id)},itemId:${JSON.stringify(item.id)},
      fieldId:${JSON.stringify(f.id)}}){projectV2Item{id}}}`);
    return `${name} cleared`;
  } else if (f.dataType === 'TEXT') v = `{text:${JSON.stringify(String(value))}}`;
  else return `! ${name} is not a field this script sets`;
  gql(`mutation{updateProjectV2ItemFieldValue(input:{projectId:${JSON.stringify(board.id)},itemId:${JSON.stringify(item.id)},
    fieldId:${JSON.stringify(f.id)},value:${v}}){projectV2Item{id}}}`);
  return `${name} ${value}`;
}

function ensureItem(board, profile, url, given) {
  const existing = board.items.get(url);
  if (existing) return { item: existing, done: [] };
  const [, repo, n] = url.match(/github\.com\/([^/]+\/[^/]+)\/(?:issues|pull)\/(\d+)/);
  const issue = JSON.parse(gh(['api', `repos/${repo}/issues/${n}`]));
  const id = gql(`mutation{addProjectV2ItemById(input:{projectId:${JSON.stringify(board.id)},contentId:${JSON.stringify(issue.node_id)}}){item{id}}}`)
    .addProjectV2ItemById.item.id;
  const item = { id, status: null, content: { __typename: issue.pull_request ? 'PullRequest' : 'Issue', url, state: issue.state.toUpperCase() } };
  board.items.set(url, item);
  if (!issue.pull_request) given.priority ??= priorityOf(issue.labels.map((l) => l.name)) ?? undefined;
  given.platform ??= profile.platforms?.[repo.split('/')[1]];
  given.status ??= 'Backlog';
  return { item, done: ['added'] };
}

export function setItems(board, profile, refs, values, log = console.log) {
  const order = [['status', 'Status'], ['priority', 'Priority'], ['size', 'Size'], ['platform', 'Platform'], ['release', 'Release'], ['sprint', 'Sprint'],
    ['prText', 'Pull request'], ['fixesText', 'Fixes']];
  for (const ref of refs) {
    const url = urlOf(ref);
    const given = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined && v !== null));
    const { item, done } = ensureItem(board, profile, url, given);
    for (const [k, name] of order) if (k in given) done.push(edit(board, item, name, given[k]));
    if (given.status) item.status = { name: given.status };
    log(`${short(url)}: ${done.join(', ') || 'no change'}`);
  }
}

// ---------- sync ----------

const REF = /\b(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?|refs?|part of)\s*:?\s+((?:[\w.-]+\/[\w.-]+)?#\d+)/gi;
const prRefs = (pr, repo) => [...(pr.body ?? '').matchAll(REF)].map((m) => urlOf(m[1].startsWith('#') ? `${repo}${m[1]}` : m[1]));

export function sync(board, profile, { dry = false, closeMerged = false } = {}) {
  const changes = [], checks = [];
  const act = (desc, fn) => { changes.push(desc); if (!dry) fn(); };
  const set = (url, values) => setItems(board, profile, [url], values, () => {});

  // 1. Open issues in the profile's repos that are not on the board.
  for (const repo of profile.repos) {
    for (const i of JSON.parse(gh(['issue', 'list', '-R', repo, '-s', 'open', '-L', '1000', '--json', 'url'])))
      if (!board.items.has(i.url)) act(`${short(i.url)}: add to the board (Backlog)`, () => set(i.url, {}));
  }

  // 2. PR state per issue, read from PR bodies. Open PRs go on the board, In review.
  const openPR = new Map(), mergedPR = new Map();
  const push = (m, k, v) => m.set(k, [...(m.get(k) ?? []), v]);
  const base = profile.prBase ? ['--base', profile.prBase] : [];
  const hasPr = ensureTextField(board, 'Pull request', dry), hasFixes = ensureTextField(board, 'Fixes', dry);
  const links = hasPr && hasFixes;
  if (!links) changes.push('create text fields "Pull request" and "Fixes"');
  const shortIn = (url, repo) => short(url).replace(`${repo}#`, '#');
  // "Ready to merge" when the board has that column and the PR's latest head is approved, or
  // carries a cleverways review tracker whose READY TO MERGE verdict was given on that head.
  const hasReady = board.field('Status')?.options?.some((o) => o.name === 'Ready to merge');
  const readyToMerge = (repo, pr) => {
    if (!hasReady || pr.isDraft || pr.reviewDecision === 'CHANGES_REQUESTED') return false;
    if (pr.reviewDecision === 'APPROVED') return true;
    const comments = JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repo}/issues/${pr.number}/comments`])).flat();
    const json = comments.find((x) => x.body?.includes('<!-- cleverways:pr-review -->'))?.body.match(/<!-- state\n([\s\S]*?)\n-->/)?.[1];
    const state = json ? JSON.parse(json) : null;
    return Boolean(state?.verdict?.startsWith('READY TO MERGE') && state.reviewedSha === pr.headRefOid);
  };
  for (const repo of profile.repos) {
    for (const pr of JSON.parse(gh(['pr', 'list', '-R', repo, '-s', 'open', '-L', '200', ...base, '--json', 'url,number,body,isDraft,reviewRequests,latestReviews,reviewDecision,headRefOid']))) {
      const refs = prRefs(pr, repo);
      pr.ready = readyToMerge(repo, pr);
      for (const u of refs) push(openPR, u, pr);
      const it = board.items.get(pr.url), fixes = refs.map((u) => shortIn(u, repo)).join(' · ');
      const want = pr.ready ? 'Ready to merge' : 'In review';
      if (!it) act(`${short(pr.url)}: add PR to the board (${want})`, () => set(pr.url, { status: want, fixesText: fixes }));
      else {
        if (it.status?.name !== want) act(`${short(pr.url)}: PR ${it.status?.name ?? 'no status'} → ${want}`, () => set(pr.url, { status: want }));
        if (links && (it.fixesText?.text ?? '') !== fixes) act(`${short(pr.url)}: Fixes "${fixes}"`, () => set(pr.url, { fixesText: fixes }));
      }
      if (!pr.isDraft && !pr.reviewRequests.length && !pr.latestReviews.length)
        checks.push(`${short(pr.url)}: nobody asked to review it. Request a reviewer so someone picks it up.`);
    }
    for (const pr of JSON.parse(gh(['pr', 'list', '-R', repo, '-s', 'merged', '-L', '200', ...base, '--json', 'url,body,mergeCommit,baseRefName'])))
      for (const u of prRefs(pr, repo)) push(mergedPR, u, pr);
  }

  // 3. Each issue on the board.
  const cur = iteration(board, 'current');
  const children = new Map();
  for (const it of board.items.values()) {
    const c = it.content;
    if (c?.__typename === 'PullRequest' && c.state !== 'OPEN' && it.status?.name !== 'Done')
      act(`${short(c.url)}: PR ${c.state.toLowerCase()}, → Done`, () => set(c.url, { status: 'Done' }));
    if (c?.__typename !== 'Issue') continue;
    if (c.parent?.url) children.set(c.parent.url, [...(children.get(c.parent.url) ?? []), it]);
    const s = it.status?.name ?? null, ref = short(c.url);
    const open = openPR.get(c.url)?.[0], merged = mergedPR.get(c.url)?.[0];
    let now = s;
    const repo = c.repository?.nameWithOwner ?? '';
    const prs = [...(openPR.get(c.url) ?? []).map((p) => `${shortIn(p.url, repo)} open`),
      ...(mergedPR.get(c.url) ?? []).map((p) => `${shortIn(p.url, repo)} merged`)].join(' · ');
    if (links && (it.prText?.text ?? '') !== prs) act(`${ref}: Pull request "${prs}"`, () => set(c.url, { prText: prs }));

    // An issue is ready to merge only when every open PR that names it is.
    const want = open && openPR.get(c.url).every((p) => p.ready) ? 'Ready to merge' : 'In review';
    if (c.state === 'OPEN' && open && [null, 'Backlog', 'Ready', 'In progress', 'In review', 'Ready to merge'].includes(s) && s !== want) {
      act(`${ref}: ${s ?? 'no status'} → ${want} (${short(open.url)})`, () => set(c.url, { status: want }));
      now = want;
    } else if (merged && !open && c.stateReason !== 'NOT_PLANNED' && !['On test', 'Done'].includes(s)) {
      act(`${ref}: ${s ?? 'no status'} → On test (${short(merged.url)} merged)`, () => set(c.url, { status: 'On test' }));
      now = 'On test';
      if (c.state === 'OPEN' && closeMerged)
        act(`${ref}: close (${short(merged.url)} merged into ${merged.baseRefName})`, () =>
          gh(['issue', 'close', c.url, '--reason', 'completed', '--comment',
            `Closed: ${merged.url} merged into \`${merged.baseRefName}\` (${merged.mergeCommit?.oid?.slice(0, 7) ?? 'merge commit'}). On test until verified.`]));
      else if (c.state === 'OPEN') checks.push(`${ref}: ${short(merged.url)} is merged and the issue is still open. Close it by the profile's rule.`);
    } else if (c.state === 'OPEN' && ['On test', 'Done'].includes(s) && !open && !merged) {
      act(`${ref}: open again, ${s} → Ready`, () => set(c.url, { status: 'Ready' }));
      now = 'Ready';
    } else if (c.state === 'CLOSED' && c.stateReason !== 'NOT_PLANNED' && !['On test', 'Done'].includes(s) && !merged)
      checks.push(`${ref}: closed, status ${s ?? 'none'}, and no merged PR names it. Set On test or Done once you know which.`);
    else if (c.stateReason === 'NOT_PLANNED' && s && s !== 'Done')
      checks.push(`${ref}: closed as not planned and still ${s}. Archive it on the board.`);

    if (['In progress', 'In review', 'Ready to merge'].includes(now) && !it.sprint && cur)
      act(`${ref}: Sprint → ${cur.title}`, () => set(c.url, { sprint: 'current' }));
    if (now === 'In progress' && !c.assignees.totalCount) checks.push(`${ref}: In progress with nobody assigned.`);
    if (it.sprint && endOf(it.sprint) <= today() && c.state === 'OPEN')
      checks.push(`${ref}: ${it.sprint.title} has ended and it is ${now}. Move it to the next sprint or back to the backlog.`);
    it.status = now ? { name: now } : null;
  }

  // 4. Parents follow their sub-issues.
  for (const [purl, kids] of children) {
    const p = board.items.get(purl);
    if (!p || p.content.state !== 'OPEN') continue;
    const s = p.status?.name ?? null, sum = p.content.subIssuesSummary;
    const started = kids.some((k) => k.content.state === 'CLOSED' || ![null, 'Backlog', 'Ready'].includes(k.status?.name ?? null));
    if (sum.total && sum.completed === sum.total && !['On test', 'Done'].includes(s))
      act(`${short(purl)}: all ${sum.total} sub-issues closed, ${s ?? 'no status'} → On test (verify its "Done when", then close)`, () => set(purl, { status: 'On test' }));
    else if (started && [null, 'Backlog', 'Ready'].includes(s))
      act(`${short(purl)}: a sub-issue has started, ${s ?? 'no status'} → In progress`, () => set(purl, { status: 'In progress' }));
  }

  for (const w of board.workflows.nodes.filter((x) => x.enabled && ['Item closed', 'Pull request merged'].includes(x.name)))
    checks.push(`Board workflow "${w.name}" is on. It moves items straight to Done and skips On test. Turn it off under the board's Workflows.`);

  console.log(`${dry ? 'Would change' : 'Changed'} (${changes.length}):`);
  for (const c of changes) console.log(`  ${c}`);
  console.log(`Needs a person (${checks.length}):`);
  for (const c of checks) console.log(`  ${c}`);
}

// ---------- CLI ----------

function main() {
  const [cmd, ...argv] = process.argv.slice(2);
  const flags = {}, refs = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { refs.push(a); continue; }
    const k = a.slice(2);
    if (['dry', 'json', 'close-merged'].includes(k)) flags[k] = true; else flags[k] = argv[++i];
  }
  if (!['set', 'show', 'list', 'sync'].includes(cmd) || (cmd === 'set' && !refs.length) || (cmd === 'show' && !refs.length)) {
    console.error('Usage: board.mjs set|show|list|sync … (see the header of this file)');
    process.exit(2);
  }
  const profile = readProfile(flags.profile);
  const url = flags.board ?? profile.board;
  if (!url) { console.log('No board: the profile has no "Board:" line in its Tracking section. Nothing updated.'); return; }
  const board = openBoard(url);

  if (cmd === 'set')
    setItems(board, profile, refs, { status: flags.status, sprint: flags.sprint, release: flags.release, priority: flags.priority, size: flags.size, platform: flags.platform });
  else if (cmd === 'show') {
    const it = board.items.get(urlOf(refs[0]));
    console.log(it ? JSON.stringify({ status: it.status?.name, priority: it.priority?.name, release: it.release?.name, sprint: it.sprint?.title, state: it.content.state }, null, 1) : 'Not on the board.');
  } else if (cmd === 'list') {
    const want = flags.status?.split(',').map((s) => s.trim());
    const rows = [...board.items.values()].filter((it) => it.content?.__typename === 'Issue')
      .filter((it) => !flags.release || it.release?.name === flags.release)
      .filter((it) => !want || want.includes(it.status?.name))
      .map((it) => ({ ref: short(it.content.url), status: it.status?.name ?? '', release: it.release?.name ?? '', sprint: it.sprint?.title ?? '', state: it.content.state, title: it.content.title }));
    if (flags.json) console.log(JSON.stringify(rows, null, 1));
    else for (const r of rows) console.log([r.ref, r.status, r.release, r.sprint, r.state, r.title].join('\t'));
  } else sync(board, profile, { dry: flags.dry, closeMerged: flags['close-merged'] });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

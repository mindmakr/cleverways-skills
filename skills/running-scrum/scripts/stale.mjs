// Has the code an issue cites changed since the issue's evidence was written?
// Used by `scrum.mjs stale <ref>`. The agent re-checks the claims only when this says
// "changed" or "no-evidence"; "unchanged" means the evidence still points at the same code.

import { execFileSync } from 'node:child_process';

const SHA = /^[0-9a-f]{7,40}$/;
const looksLikeSha = (s) => SHA.test(s) && /\d/.test(s) && /[a-f]/.test(s);

// Route groups put brackets in paths (app/(auth)/profile.tsx), and markdown wraps paths in
// brackets too, so drop only the brackets that have no partner.
const count = (s, c) => s.split(c).length - 1;
function tidy(path) {
  let p = path;
  while (p.startsWith('(') && count(p, '(') > count(p, ')')) p = p.slice(1);
  while (p.endsWith(')') && count(p, ')') > count(p, '(')) p = p.slice(0, -1);
  return p;
}
// Agent instructions and settings are not the code an issue is about.
const IGNORED = /^\.(agents|claude)\//;

// texts: [{ body, createdAt }] — the issue body and its comments.
export function parseEvidence(texts) {
  const files = new Set(), shas = new Set();
  const addFile = (f) => { const p = tidy(f); if (!IGNORED.test(p)) files.add(p); };
  let evidenceAt = null;
  for (const { body = '', createdAt } of texts) {
    const before = files.size + shas.size;
    for (const m of body.matchAll(/github\.com\/[\w.-]+\/[\w.-]+\/blob\/([0-9a-f]{7,40})\/([^\s#?]+)/g)) { shas.add(m[1]); addFile(m[2]); }
    for (const m of body.matchAll(/github\.com\/[\w.-]+\/[\w.-]+\/commit\/([0-9a-f]{7,40})/g)) shas.add(m[1]);
    const text = body.replace(/https?:\/\/\S+/g, ' ');
    for (const m of text.matchAll(/(?<![\w/.@-])([\w@.()-]+(?:\/[\w@.()-]+)+\.[A-Za-z]{1,5})(?::\d+(?:-\d+)?)?(?![\w/])/g)) addFile(m[1]);
    for (const m of text.matchAll(/(?<![\w/.@-])([\w@-]+\.[A-Za-z]{1,5}):\d+/g)) addFile(m[1]);
    for (const m of text.matchAll(/\b[0-9a-f]{7,40}\b/g)) if (looksLikeSha(m[0])) shas.add(m[0]);
    if (files.size + shas.size > before && (!evidenceAt || createdAt > evidenceAt)) evidenceAt = createdAt;
  }
  return { files: [...files], shas: [...shas], evidenceAt };
}

export function staleVerdict({ files, changed, evidenceAt, now, staleDays }) {
  if (changed.length) return 'changed';
  if (!files.length || !evidenceAt || (now - Date.parse(evidenceAt)) / 864e5 > staleDays) return 'no-evidence';
  return 'unchanged';
}

const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const ok = (dir, args) => { try { git(dir, args); return true; } catch { return false; } };

// Commits on the base that touched `files` after `since` (a SHA in this repo, or an ISO date).
// An unknown SHA gives the whole history, so the caller re-checks rather than trusting it.
export function changedSince(dir, base, since, files) {
  if (!files.length) return [];
  const ref = baseRef(dir, base);
  const range = SHA.test(since) ? (ok(dir, ['cat-file', '-e', `${since}^{commit}`]) ? [`${since}..${ref}`] : [ref]) : [`--since=${since}`, ref];
  const out = git(dir, ['log', '--format=%h%x09%s', ...range, '--', ...files]);
  return out ? out.split('\n').map((l) => { const [sha, ...s] = l.split('\t'); return { sha, subject: s.join('\t') }; }) : [];
}

const baseRef = (dir, base) => (ok(dir, ['rev-parse', '--verify', '-q', `origin/${base}`]) ? `origin/${base}` : base);

// Where the evidence was taken: the newest cited SHA that is on the base branch. A SHA from a
// PR branch or an unrelated branch (screenshots) says nothing about the base, so it falls back
// to the evidence date.
export function evidencePoint(dir, base, shas, fallback) {
  const ref = baseRef(dir, base);
  const onBase = shas.filter((s) => ok(dir, ['merge-base', '--is-ancestor', s, ref]));
  // All on one line of history, so the newest is the one every other is an ancestor of.
  return onBase.find((s) => onBase.every((o) => o === s || ok(dir, ['merge-base', '--is-ancestor', o, s]))) ?? fallback;
}

export function staleReport(profile, ref, now = Date.now()) {
  const [repo, n] = ref.replace('https://github.com/', '').replace(/\/(issues|pull)\//, '#').split('#');
  const issue = JSON.parse(execFileSync('gh', ['issue', 'view', n, '-R', repo, '--json', 'body,createdAt,comments,title'], { encoding: 'utf8' }));
  const e = parseEvidence([{ body: issue.body, createdAt: issue.createdAt }, ...issue.comments.map((c) => ({ body: c.body, createdAt: c.createdAt }))]);
  const base = profile.prBase ?? 'main';
  const repos = [];
  for (const [name, dir] of Object.entries(profile.localPaths ?? {})) {
    if (!ok(dir, ['rev-parse', '--git-dir'])) { repos.push({ repo: name, error: `no git repo at ${dir}` }); continue; }
    ok(dir, ['fetch', '-q', 'origin', base]);
    const ref = baseRef(dir, base);
    const files = e.files.filter((f) => git(dir, ['log', '-1', '--format=%h', ref, '--', f]));
    if (!files.length) continue;
    const since = evidencePoint(dir, base, e.shas, e.evidenceAt);
    repos.push({ repo: name, base: ref, since, files, changed: since ? changedSince(dir, base, since, files) : [] });
  }
  const files = repos.flatMap((r) => r.files ?? []), changed = repos.flatMap((r) => r.changed ?? []);
  return {
    ref: `${repo}#${n}`, title: issue.title, evidenceAt: e.evidenceAt, cited: e.files, shas: e.shas, repos,
    verdict: staleVerdict({ files, changed, evidenceAt: e.evidenceAt, now, staleDays: profile.thresholds?.stale ?? 30 }),
  };
}

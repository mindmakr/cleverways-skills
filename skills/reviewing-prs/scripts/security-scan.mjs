#!/usr/bin/env node
// Runs three security scans on what a pull request ADDS, locally through Docker, so a review
// gets them even when CI cannot run. The same tools and versions as a `security.yml` workflow:
//
//   secrets       gitleaks, on the lines the PR adds
//   code          Semgrep (OWASP, Node, JavaScript, TypeScript, React, secrets rules) on the PR's changed
//                 files, minus findings the same files already had at the merge base
//   dependencies  osv-scanner on every lockfile, minus advisories the merge base already had;
//                 skipped when the PR changes no lockfile
//
// Only the changed files and lockfiles are copied out of git, so no scanner needs git and the
// run takes seconds. Secret values are never printed.
//
// Usage (from the repository):
//   node security-scan.mjs --pr <n> [--json]            fetches the PR head and its base branch
//   node security-scan.mjs --base <ref> --head <ref> [--json]
// Exit: 0 nothing new, 1 new findings, 2 usage, 3 Docker not available, 4 a scan did not run.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// Each image runs its own tool by default, except Semgrep, which is named in the command.
const IMAGES = {
  gitleaks: 'zricethezav/gitleaks:v8.30.1',
  semgrep: 'semgrep/semgrep:1.178.0',
  osv: 'ghcr.io/google/osv-scanner:v2.6.0',
};
const SEMGREP_CONFIGS = ['p/javascript', 'p/typescript', 'p/react', 'p/nodejs', 'p/owasp-top-ten', 'p/secrets'];
const LOCKFILES = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lock)$/;

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i === -1 ? null : argv[i + 1]; };
const asJson = argv.includes('--json');
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 });
const gitBuf = (...a) => execFileSync('git', a, { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });

let base = opt('base'), head = opt('head');
const pr = opt('pr');
if (pr) {
  const info = JSON.parse(execFileSync('gh', ['pr', 'view', pr, '--json', 'baseRefName,headRefOid'], { encoding: 'utf8' }));
  git('fetch', '-q', 'origin', info.baseRefName, `pull/${pr}/head`);
  base = `origin/${info.baseRefName}`;
  head = info.headRefOid;
}
if (!base || !head) { console.error('Usage: security-scan.mjs --pr <n> | --base <ref> --head <ref> [--json]'); process.exit(2); }
if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) {
  console.error('Docker is not running. Start Docker Desktop, or record "security scan not run" in the review.');
  process.exit(3);
}

const mergeBase = git('merge-base', base, head).trim();
const changes = git('diff', '--name-status', '--no-renames', mergeBase, head).trim().split('\n').filter(Boolean)
  .map((l) => { const [s, ...p] = l.split('\t'); return { status: s, path: p.join('\t') }; });
const live = changes.filter((c) => c.status !== 'D').map((c) => c.path);

const work = mkdtempSync(join(tmpdir(), 'cw-security-'));
const docker = (image, dir, args) =>
  spawnSync('docker', ['run', '--rm', '-v', `${dir.replace(/\\/g, '/')}:/src`, '-w', '/src', image, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
const lastLine = (r) => (r.stderr || r.stdout || '').trim().split('\n').pop();
const exportFiles = (ref, files, dir) => {
  mkdirSync(dir, { recursive: true });
  for (const f of files) {
    let buf;
    try { buf = gitBuf('show', `${ref}:${f}`); } catch { continue; } // the file is not in this ref
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), buf);
  }
};
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const result = { base, head, mergeBase, changedFiles: live.length, secrets: [], code: [], dependencies: [], notRun: [] };

try {
  // 1. Secrets: each changed file rebuilt from its added lines only, keeping the real line numbers.
  const added = join(work, 'added'), lines = {}, lineNo = {};
  let file = null, next = 0;
  for (const l of git('diff', '-U0', '--no-renames', '--no-color', mergeBase, head).split('\n')) {
    if (l.startsWith('+++ ')) { file = l.startsWith('+++ b/') ? l.slice(6) : null; continue; }
    const hunk = l.match(/^@@ -\S+ \+(\d+)/);
    if (hunk) { next = Number(hunk[1]); continue; }
    if (file && l.startsWith('+')) { (lines[file] ??= []).push(l.slice(1)); (lineNo[file] ??= []).push(next++); }
  }
  for (const [f, ls] of Object.entries(lines)) { mkdirSync(dirname(join(added, f)), { recursive: true }); writeFileSync(join(added, f), `${ls.join('\n')}\n`); }
  if (Object.keys(lines).length) {
    const r = docker(IMAGES.gitleaks, added, ['dir', '/src', '--no-banner', '--redact', '--exit-code', '0', '-f', 'json', '-r', '/src/.gitleaks.json']);
    const found = readJson(join(added, '.gitleaks.json'));
    if (!found) result.notRun.push(`secrets: gitleaks failed (${lastLine(r)})`);
    else for (const f of found) {
      const path = f.File.replace(/^\/src\//, '');
      result.secrets.push({ rule: f.RuleID, where: `${path}:${lineNo[path]?.[f.StartLine - 1] ?? '?'}`, description: f.Description });
    }
  }

  // 2. Code: the changed files at head, against the same files at the merge base.
  if (live.length) {
    const scan = (ref, name) => {
      const dir = join(work, name);
      exportFiles(ref, live, dir);
      const r = docker(IMAGES.semgrep, dir, ['semgrep', 'scan', '--metrics=off', '--no-git-ignore', '--json', '-o', '/src/.semgrep.json', '-q',
        ...SEMGREP_CONFIGS.flatMap((c) => ['--config', c]), '.']);
      const j = readJson(join(dir, '.semgrep.json'));
      if (!j) { result.notRun.push(`code (${name}): semgrep failed (${lastLine(r)})`); return null; }
      // Keyed by rule, file and matched text, so findings that only moved lines are not new.
      return j.results.map((x) => ({ key: `${x.check_id}|${x.path}|${x.extra.lines.trim()}`, x }));
    };
    const now = scan(head, 'head'), before = scan(mergeBase, 'base');
    if (now && before) {
      const seen = {};
      for (const b of before) seen[b.key] = (seen[b.key] ?? 0) + 1;
      for (const n of now) {
        if (seen[n.key] > 0) { seen[n.key]--; continue; }
        result.code.push({ rule: n.x.check_id.split('.').pop(), severity: n.x.extra.severity, where: `${n.x.path.replace(/^\.\//, '')}:${n.x.start.line}`,
          message: n.x.extra.message.split('\n')[0].slice(0, 200) });
      }
    }
  }

  // 3. Dependencies: every lockfile at both ends, when the PR touches one. A finding is a
  // "package advisory" pair, so an upgrade that keeps an old advisory is not new.
  if (changes.some((c) => LOCKFILES.test(c.path))) {
    const pairs = (ref, name) => {
      const dir = join(work, `lock-${name}`);
      exportFiles(ref, git('ls-tree', '-r', '--name-only', ref).split('\n').filter((f) => LOCKFILES.test(f)), dir);
      const r = docker(IMAGES.osv, dir, ['scan', 'source', '-r', '--format', 'json', '--output-file', '/src/.osv.json', '/src']);
      const j = readJson(join(dir, '.osv.json'));
      if (!j || r.status > 1) { result.notRun.push(`dependencies (${name}): osv-scanner failed (exit ${r.status}: ${lastLine(r)})`); return null; }
      const out = new Map();
      for (const res of j.results ?? []) for (const p of res.packages ?? []) for (const v of p.vulnerabilities ?? []) {
        const sev = Math.max(0, ...(p.groups ?? []).filter((g) => g.ids.includes(v.id)).map((g) => Number(g.max_severity) || 0));
        out.set(`${p.package.name} ${v.id}`, { package: `${p.package.name}@${p.package.version}`, id: v.id, severity: sev || null,
          lockfile: res.source.path.replace(/^\/src\//, ''), summary: (v.summary ?? '').slice(0, 120), url: `https://osv.dev/vulnerability/${v.id}` });
      }
      return out;
    };
    const now = pairs(head, 'head'), before = pairs(mergeBase, 'base');
    if (now && before) for (const [k, v] of now) if (!before.has(k)) result.dependencies.push(v);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

const total = result.secrets.length + result.code.length + result.dependencies.length;
if (asJson) console.log(JSON.stringify(result, null, 1));
else {
  console.log(`Security scan of ${result.changedFiles} changed files, ${mergeBase.slice(0, 8)}..${head.slice(0, 8)}: ${total} new finding(s).`);
  for (const s of result.secrets) console.log(`  secret   ${s.where}  ${s.rule} (value not shown)`);
  for (const c of result.code) console.log(`  code     ${c.where}  ${c.severity} ${c.rule}: ${c.message}`);
  for (const d of result.dependencies) console.log(`  package  ${d.package} in ${d.lockfile}  ${d.severity ?? '?'} ${d.id} ${d.summary}`);
  for (const n of result.notRun) console.log(`  not run  ${n}`);
}
process.exit(total ? 1 : result.notRun.length ? 4 : 0);

#!/usr/bin/env node
// Pushes screenshots to an orphan branch (default `visual-tests`) through a temporary
// git worktree, so the current checkout is never touched. Prints one pinned URL per file.
//
// Usage: node publish-screenshots.mjs --repo <repo dir> --run <run id> [--branch visual-tests] <file.png> [...]

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const argv = process.argv.slice(2);
const take = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const [, value] = argv.splice(i, 2);
  return value;
};
const repo = take('repo', process.cwd());
const run = take('run');
const branch = take('branch', 'visual-tests');
const files = argv;
if (!run || files.length === 0) {
  console.error('Usage: node publish-screenshots.mjs --repo <dir> --run <id> [--branch visual-tests] <file> [...]');
  process.exit(2);
}

const git = (args, cwd = repo) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const nwo = take('nwo') ?? execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { cwd: repo, encoding: 'utf8' }).trim();
const work = mkdtempSync(join(tmpdir(), 'visual-tests-'));
const temp = `visual-tests-${run}`;

try {
  const exists = git(['ls-remote', '--heads', 'origin', branch]) !== '';
  if (exists) {
    git(['fetch', 'origin', `${branch}:refs/remotes/origin/${branch}`]);
    git(['worktree', 'add', '--detach', work, `origin/${branch}`]);
  } else {
    git(['worktree', 'add', '--detach', work]);
    git(['checkout', '--orphan', temp], work);
    git(['rm', '-rf', '--quiet', '--ignore-unmatch', '.'], work);
  }
  const dest = join(work, 'runs', run);
  mkdirSync(dest, { recursive: true });
  for (const f of files) copyFileSync(f, join(dest, basename(f)));
  git(['add', 'runs'], work);
  git(['commit', '-m', `Visual test screenshots: ${run}`], work);
  git(['push', 'origin', `HEAD:refs/heads/${branch}`], work);
  const sha = git(['rev-parse', 'HEAD'], work);
  for (const f of files) {
    console.log(`${basename(f)}\thttps://github.com/${nwo}/blob/${sha}/runs/${run}/${encodeURIComponent(basename(f))}?raw=true`);
  }
} finally {
  try { git(['worktree', 'remove', '--force', work]); } catch { rmSync(work, { recursive: true, force: true }); }
  try { git(['branch', '-D', temp]); } catch {}
}

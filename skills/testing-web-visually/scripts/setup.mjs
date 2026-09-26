#!/usr/bin/env node
// One-time setup for web visual tests: installs Playwright and Chromium into
// ~/.cache/cleverways, which visual-sweep.mjs looks in. Safe to re-run.

import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const cache = join(homedir(), '.cache', 'cleverways');
mkdirSync(cache, { recursive: true });
const run = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' }).status === 0;

const ok = run('npm', ['i', '--silent', '--prefix', cache, 'playwright'])
  && run('npx', ['--prefix', cache, 'playwright', 'install', 'chromium']);
console.log(ok ? `✓ Playwright and Chromium ready in ${cache}` : '✗ Playwright setup failed; see the output above.');
process.exit(ok ? 0 : 1);

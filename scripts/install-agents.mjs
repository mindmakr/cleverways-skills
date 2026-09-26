#!/usr/bin/env node
// Copies this pack's skills into the cross-agent skills folder, for agents that
// read ~/.agents/skills (Codex, Gemini CLI, Copilot CLI). Claude Code installs
// the pack as a plugin instead; see README.md.
//
// Usage: node scripts/install-agents.mjs [--target <dir>]
// Re-run after `git pull` to update.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const i = args.indexOf('--target');
const target = i === -1 ? join(homedir(), '.agents', 'skills') : args[i + 1];
const source = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills');

mkdirSync(target, { recursive: true });
for (const name of readdirSync(source)) {
  const dest = join(target, name);
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  cpSync(join(source, name), dest, { recursive: true });
  console.log(`installed ${name} -> ${dest}`);
}

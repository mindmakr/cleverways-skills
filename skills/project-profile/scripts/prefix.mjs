#!/usr/bin/env node
// Measures what loads into the fixed agent prompt prefix for one project, and
// drafts a project-local .claude/settings.local.json that turns off the rest.
//
// Usage:
//   node prefix.mjs report [--project <dir>] [--home <dir>]
//   node prefix.mjs draft  [--project <dir>] [--home <dir>] [--keep a,b] [--sync-off]
//   node prefix.mjs write  [--project <dir>] [--home <dir>] [--keep a,b] [--sync-off] --confirm
//
//   --project  the project root. Default: the current directory.
//   --home     the folder that holds .claude (default: the user's home).
//   --keep     comma-separated plugin names (with or without @marketplace) and
//              user skill names to leave on.
//   --sync-off also set syncClaudeAiSkills and syncClaudeAiPlugins to false and
//              disableClaudeAiConnectors to true. Ask the person first.
//   --confirm  required by write. Without it nothing is written.
//
// report prints counts as JSON. draft prints the merged file and writes nothing.
// write saves the draft to <project>/.claude/settings.local.json and adds that
// path to the project's git exclude. It never touches the user-level settings.

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const LOCAL = '.claude/settings.local.json';
const SETUP_PLUGIN = 'cleverways';

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
};

const isDir = (p) => {
  try {
    return statSync(p).isDirectory(); // statSync follows symlinks and junctions
  } catch {
    return false;
  }
};

const description = (file) => {
  try {
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(file, 'utf8').replace(/^﻿/, ''));
    const d = m && /^description:\s*(.*)$/m.exec(m[1]);
    return d ? d[1].trim().replace(/^["']|["']$/g, '').length : 0;
  } catch {
    return 0;
  }
};

// Folders under <home>/.claude/skills that hold a skill. Links are followed;
// names starting with "." and the "synced" folder are skipped.
export function userSkills(home) {
  const dir = join(home, '.claude', 'skills');
  if (!isDir(dir)) return [];
  return readdirSync(dir)
    .filter((n) => !n.startsWith('.') && n !== 'synced' && isDir(join(dir, n)))
    .sort()
    .map((name) => ({ name, chars: description(join(dir, name, 'SKILL.md')) }));
}

// enabledPlugins from user, project and local settings, later files win.
export function enabledPlugins(project, home) {
  const files = [
    ['user', join(home, '.claude', 'settings.json')],
    ['project', join(project, '.claude', 'settings.json')],
    ['local', join(project, LOCAL)],
  ];
  const out = {};
  for (const [layer, file] of files) {
    const ep = readJson(file)?.enabledPlugins;
    if (ep && typeof ep === 'object') for (const [k, v] of Object.entries(ep)) out[k] = { on: v === true, layer };
  }
  return out;
}

// MCP server names: project .mcp.json and the user config (~/.claude.json).
export function mcpServers(project, home) {
  const names = new Map();
  const add = (obj, from) => {
    if (obj && typeof obj === 'object') for (const k of Object.keys(obj)) names.set(k, from);
  };
  add(readJson(join(project, '.mcp.json'))?.mcpServers, 'project');
  const user = readJson(join(home, '.claude.json'));
  add(user?.mcpServers, 'user');
  for (const [p, v] of Object.entries(user?.projects || {})) {
    if (resolve(p) === resolve(project)) add(v?.mcpServers, 'user-project');
  }
  return [...names].map(([name, from]) => ({ name, from }));
}

const bare = (key) => key.split('@')[0];
const matches = (keep, key) => keep.includes(key) || keep.includes(bare(key));

// What the project's own files keep on: its settings.json plugins, anything the
// person named, the setup plugin, and plugins the local file already turns on.
export function keepers(project, home, keep = []) {
  const projectOn = Object.entries(readJson(join(project, '.claude', 'settings.json'))?.enabledPlugins || {})
    .filter(([, v]) => v === true)
    .map(([k]) => k);
  const localOn = Object.entries(readJson(join(project, LOCAL))?.enabledPlugins || {})
    .filter(([, v]) => v === true)
    .map(([k]) => k);
  return [...keep, SETUP_PLUGIN, ...projectOn, ...localOn];
}

export function report(project, home, keep = []) {
  const plugins = enabledPlugins(project, home);
  const skills = userSkills(home);
  const servers = mcpServers(project, home);
  const kept = keepers(project, home, keep);
  const on = Object.entries(plugins).filter(([, v]) => v.on).map(([k]) => k);
  return {
    plugins: { enabled: on.length, keep: on.filter((k) => matches(kept, k)), off: on.filter((k) => !matches(kept, k)) },
    skills: { count: skills.length, descriptionChars: skills.reduce((n, s) => n + s.chars, 0) },
    mcpServers: { count: servers.length, names: servers },
    trimmed: existsSync(join(project, LOCAL)),
  };
}

// The merged file. Existing keys stay; a plugin or skill the file already
// sets, or that is kept, is not changed.
export function draft(project, home, { keep = [], syncOff = false } = {}) {
  const current = readJson(join(project, LOCAL)) || {};
  const kept = keepers(project, home, keep);
  const ep = { ...(current.enabledPlugins || {}) };
  for (const [k, v] of Object.entries(enabledPlugins(project, home))) {
    if (v.on && !matches(kept, k) && !(k in ep)) ep[k] = false;
  }
  const so = { ...(current.skillOverrides || {}) };
  for (const s of userSkills(home)) {
    if (!matches(kept, s.name) && !(s.name in so)) so[s.name] = 'off';
  }
  const next = { ...current };
  if (Object.keys(ep).length) next.enabledPlugins = ep;
  if (Object.keys(so).length) next.skillOverrides = so;
  if (syncOff) {
    next.syncClaudeAiSkills = false;
    next.syncClaudeAiPlugins = false;
    next.disableClaudeAiConnectors = true;
  }
  return next;
}

function excludeFile(project) {
  const p = execFileSync('git', ['-C', project, 'rev-parse', '--git-path', 'info/exclude'], { encoding: 'utf8' }).trim();
  return isAbsolute(p) ? p : resolve(project, p);
}

export function write(project, home, opts) {
  const next = draft(project, home, opts);
  const file = join(project, LOCAL);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  let excluded = false;
  try {
    const ex = excludeFile(project);
    const text = existsSync(ex) ? readFileSync(ex, 'utf8') : '';
    if (!text.split(/\r?\n/).includes(LOCAL)) {
      mkdirSync(dirname(ex), { recursive: true });
      appendFileSync(ex, (text && !text.endsWith('\n') ? '\n' : '') + LOCAL + '\n');
    }
    excluded = true;
  } catch {
    // not a git repository: the person decides where to ignore it
  }
  return { file, excluded };
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const opt = { project: process.cwd(), home: homedir(), keep: [], syncOff: false, confirm: false };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--project') opt.project = resolve(rest[++i]);
    else if (a === '--home') opt.home = resolve(rest[++i]);
    else if (a === '--keep') opt.keep = (rest[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--sync-off') opt.syncOff = true;
    else if (a === '--confirm') opt.confirm = true;
    else {
      console.error(`unknown argument: ${a}`);
      return 2;
    }
  }
  if (cmd === 'report') console.log(JSON.stringify(report(opt.project, opt.home, opt.keep), null, 2));
  else if (cmd === 'draft') console.log(JSON.stringify(draft(opt.project, opt.home, opt), null, 2));
  else if (cmd === 'write') {
    if (!opt.confirm) {
      console.error('refusing to write without --confirm; show the draft to the person first');
      return 2;
    }
    const r = write(opt.project, opt.home, opt);
    console.log(`wrote ${r.file}${r.excluded ? ' (added to the git exclude)' : ' (not a git repository: ignore it yourself)'}`);
  } else {
    console.error('usage: prefix.mjs report|draft|write [--project <dir>] [--home <dir>] [--keep a,b] [--sync-off] [--confirm]');
    return 2;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}

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

// A settings file that exists, has text and does not parse: warn once on stderr
// (naming the file) and treat it as empty. A missing or empty file is silent.
const warned = new Set();
const readSettings = (file) => {
  let text;
  try {
    text = readFileSync(file, 'utf8').replace(/^﻿/, '');
  } catch {
    return null;
  }
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    if (!warned.has(file)) {
      warned.add(file);
      console.error(`warning: ${file} is not valid JSON (${e.message}); treating it as empty`);
    }
    return null;
  }
};

// The project's own local file. Missing or empty is {}; present but not a JSON
// object is an error, so a draft or a write never drops the keys it cannot read.
const localSettings = (project) => {
  const file = join(project, LOCAL);
  if (!existsSync(file)) return {};
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
  if (!text.trim()) return {};
  let value;
  try {
    value = JSON.parse(text);
  } catch (e) {
    throw new Error(`${file} is not valid JSON (${e.message}); fix or move it, nothing was changed`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${file} is not a JSON object; fix or move it, nothing was changed`);
  }
  for (const key of ['enabledPlugins', 'skillOverrides']) {
    const v = value[key];
    if (v !== undefined && (!v || typeof v !== 'object' || Array.isArray(v))) {
      throw new Error(`${file}: ${key} is not a JSON object; fix or move it, nothing was changed`);
    }
  }
  return value;
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
    const d = m && /^description:[ \t]*(.*)$/m.exec(m[1]);
    if (!d) return 0;
    const head = d[1].trim();
    const block = /^([>|])(?:[1-9][+-]?|[+-][1-9]?)?(?:\s+#.*)?$/.exec(head);
    if (block) {
      // YAML block scalar: the text is on the indented lines that follow.
      const rest = m[1].slice(d.index + d[0].length).split(/\r?\n/).slice(1);
      const lines = [];
      for (const l of rest) {
        if (l.trim() && !/^\s/.test(l)) break;
        lines.push(l.trim());
      }
      while (lines.length && !lines[lines.length - 1]) lines.pop();
      return lines.join(block[1] === '>' ? ' ' : '\n').length;
    }
    return head.replace(/^["']|["']$/g, '').length;
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
    // the local file is checked, and stops the run, by localSettings
    const ep = (layer === 'local' ? readJson(file) : readSettings(file))?.enabledPlugins;
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
  const projectOn = Object.entries(readSettings(join(project, '.claude', 'settings.json'))?.enabledPlugins || {})
    .filter(([, v]) => v === true)
    .map(([k]) => k);
  const localOn = Object.entries(localSettings(project).enabledPlugins || {})
    .filter(([, v]) => v === true)
    .map(([k]) => k);
  return [...keep, SETUP_PLUGIN, ...projectOn, ...localOn];
}

export function report(project, home, keep = []) {
  const plugins = enabledPlugins(project, home);
  const skills = userSkills(home);
  const servers = mcpServers(project, home);
  const kept = keepers(project, home, keep);
  const local = localSettings(project);
  const on = Object.entries(plugins).filter(([, v]) => v.on).map(([k]) => k);
  return {
    plugins: { enabled: on.length, keep: on.filter((k) => matches(kept, k)), off: on.filter((k) => !matches(kept, k)) },
    skills: { count: skills.length, descriptionChars: skills.reduce((n, s) => n + s.chars, 0) },
    mcpServers: { count: servers.length, names: servers },
    trimmed:
      Object.values(local.enabledPlugins || {}).some((v) => v === false) ||
      Object.values(local.skillOverrides || {}).some((v) => v === 'off'),
  };
}

// The merged file. Existing keys stay; a plugin or skill the file already
// sets, or that is kept, is not changed.
export function draft(project, home, { keep = [], syncOff = false } = {}) {
  const current = localSettings(project);
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

// The project's path under the repo root, with a trailing slash ("" at the root).
function prefixInRepo(project) {
  return execFileSync('git', ['-C', project, 'rev-parse', '--show-prefix'], { encoding: 'utf8' }).replace(/\r?\n$/, '');
}

// One path as a gitignore line: a backslash before characters that mean
// something there, and before leading or trailing spaces.
const ignoreEntry = (path) =>
  path
    .replace(/[\\[\]*?!#]/g, '\\$&')
    .replace(/^ +| +$/g, (m) => m.replace(/ /g, '\\ '));

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
    const entry = ignoreEntry(prefixInRepo(project) + LOCAL);
    const text = existsSync(ex) ? readFileSync(ex, 'utf8') : '';
    if (!text.split(/\r?\n/).includes(entry)) {
      mkdirSync(dirname(ex), { recursive: true });
      appendFileSync(ex, (text && !text.endsWith('\n') ? '\n' : '') + entry + '\n');
    }
    excluded = true;
  } catch {
    // not a git repository: the person decides where to ignore it
  }
  return { file, excluded };
}

function main(argv) {
  try {
    return run(argv);
  } catch (e) {
    console.error(e.message);
    return 1;
  }
}

function usage() {
  console.error('usage: prefix.mjs report|draft|write [--project <dir>] [--home <dir>] [--keep a,b] [--sync-off] [--confirm]');
  return 2;
}

function run(argv) {
  const [cmd, ...rest] = argv;
  const opt = { project: process.cwd(), home: homedir(), keep: [], syncOff: false, confirm: false };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--project' || a === '--home') {
      const v = rest[++i];
      if (!v || v.startsWith('--')) return usage();
      opt[a.slice(2)] = resolve(v);
    } else if (a === '--keep') {
      const v = rest[++i];
      if (v === undefined || v.startsWith('--')) return usage();
      opt.keep = v.split(',').map((s) => s.trim()).filter(Boolean);
    }
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
    return usage();
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}

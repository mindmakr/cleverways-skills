#!/usr/bin/env node
// Renders a scrum.mjs report plus the ritual's notes (markdown) into one self-contained page.
// In Claude Code the page is published as an Artifact; other agents open the file.
//
// Usage: status-page.mjs --report report.json [--notes notes.md] --out page.html
//
// The output starts with <title> and <style> and has no <html>/<body>, because the Artifact
// publisher adds the document skeleton; browsers render it as is when opened as a file.

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const DAY = 864e5;
const when = (ms) => new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
const date = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

const FLAGS = {
  conflict: ['merge conflict', 'bad'], 'checks-failing': ['checks failing', 'bad'],
  stuck: ['stuck', 'warn'], abandoned: ['no activity', 'warn'], 'not-started': ['not started', 'warn'],
  unassigned: ['nobody assigned', 'info'], 'review-behind-head': ['needs review', 'info'],
};
const WEIGHT = { bad: 0, warn: 1, info: 2 };

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
}

export function markdown(md) {
  const out = [];
  let list = false;
  const close = () => { if (list) { out.push('</ul>'); list = false; } };
  for (const raw of (md ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { close(); continue; }
    const h = line.match(/^#{1,4}\s+(.*)/), li = line.match(/^[-*]\s+(.*)/);
    if (h) { close(); out.push(`<h3>${inline(h[1])}</h3>`); } else if (li) {
      if (!list) { out.push('<ul>'); list = true; }
      out.push(`<li>${inline(li[1])}</li>`);
    } else { close(); out.push(`<p>${inline(line)}</p>`); }
  }
  close();
  return out.join('\n');
}

const owner = (item, owners) => {
  if (item.assignees?.length) return esc(item.assignees.join(', '));
  const repo = item.ref.split('#')[0].split('/')[1];
  return owners?.[repo] ? `${esc(owners[repo])} (repo owner)` : '<span class="muted">nobody</span>';
};
const worst = (item) => Math.min(...item.flags.map((f) => WEIGHT[FLAGS[f]?.[1] ?? 'info']));
const row = (item, owners, extra = '') => `<li class="row">
  <a class="ref" href="${esc(item.url)}">${esc(item.ref)}</a>
  <span class="title">${esc(item.title)}</span>
  <span class="meta"><span class="pill">${esc(item.status ?? 'no status')}</span>${extra}<span class="owner">${owner(item, owners)}</span></span>
</li>`;
const empty = '<p class="empty">Nothing here.</p>';

export function render(report, notes, now = Date.parse(report.generatedAt)) {
  const s = report.sprint, cur = s.current;
  const title = `${report.board.title ?? 'Project'} sprint status`;
  const open = report.items.filter((i) => i.state === 'OPEN');
  const flagged = open.filter((i) => i.flags?.length).sort((a, b) => worst(a) - worst(b) || a.ref.localeCompare(b.ref));
  const ready = open.filter((i) => i.type === 'pr' && (i.status === 'Ready to merge' || (i.pr?.verdict?.startsWith('READY TO MERGE') && i.pr.reviewedSha === i.pr.headSha)));

  let sprint;
  if (cur) {
    const start = Date.parse(`${cur.startDate}T00:00:00Z`), end = start + cur.duration * DAY;
    const day = Math.min(cur.duration, Math.floor((now - start) / DAY) + 1);
    const rest = Math.max(0, s.planned - s.done - s.onTest - s.inProgress);
    const pct = (n) => (s.planned ? (100 * n) / s.planned : 0).toFixed(1);
    sprint = `<p class="lede">${esc(cur.title)} · Day ${day} of ${cur.duration} · ends ${date(end - DAY)}</p>
    <dl class="tiles">
      <div><dt>planned</dt><dd>${s.planned}</dd></div>
      <div><dt>in progress</dt><dd>${s.inProgress}</dd></div>
      <div><dt>on test</dt><dd>${s.onTest}</dd></div>
      <div><dt>done</dt><dd>${s.done}</dd></div>
    </dl>
    <div class="bar" role="img" aria-label="${s.done} done, ${s.onTest} on test, ${s.inProgress} in progress, ${rest} not started of ${s.planned}">
      <span class="done" style="width:${pct(s.done)}%"></span><span class="test" style="width:${pct(s.onTest)}%"></span><span class="prog" style="width:${pct(s.inProgress)}%"></span>
    </div>
    <p class="muted small">${rest} not started.${s.previous ? ` ${esc(s.previous)} finished ${s.previousDone} issue${s.previousDone === 1 ? '' : 's'}.` : ''}</p>`;
  } else sprint = '<p class="lede">No current sprint on the board.</p>';

  const chips = (item) => item.flags.map((f) => `<span class="chip ${FLAGS[f]?.[1] ?? 'info'}">${esc(FLAGS[f]?.[0] ?? f)}</span>`).join('');

  return `<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Sans+Condensed:wght@600&display=swap">
<style>
/* Layout: one reading column; summary first, then what needs a person, then notes. */
:root {
  --paper: #f3f6f4; --card: #ffffff; --ink: #15201c; --muted: #5a6a63; --line: #d8e0db; --accent: #1d6b58;
  --bad: #b3261e; --bad-bg: #fbe9e7; --warn: #8a5300; --warn-bg: #fdf1dc; --info: #235a9c; --info-bg: #e6eef9;
  --done: #1d6b58; --test: #6fa99a; --prog: #b9d5cc; --rest: #e3e9e5;
  --sans: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --cond: "IBM Plex Sans Condensed", "Arial Narrow", var(--sans);
  --mono: "IBM Plex Mono", ui-monospace, Consolas, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --paper: #0f1513; --card: #161e1b; --ink: #e4ebe7; --muted: #95a59e; --line: #26312d; --accent: #6cc7ac;
  --bad: #ff9a8f; --bad-bg: #3a1714; --warn: #f2bd6b; --warn-bg: #36270c; --info: #9cc2fa; --info-bg: #15263d;
  --done: #6cc7ac; --test: #3f8a77; --prog: #2c5247; --rest: #1f2926; color-scheme: dark; } }
:root[data-theme="dark"] {
  --paper: #0f1513; --card: #161e1b; --ink: #e4ebe7; --muted: #95a59e; --line: #26312d; --accent: #6cc7ac;
  --bad: #ff9a8f; --bad-bg: #3a1714; --warn: #f2bd6b; --warn-bg: #36270c; --info: #9cc2fa; --info-bg: #15263d;
  --done: #6cc7ac; --test: #3f8a77; --prog: #2c5247; --rest: #1f2926; color-scheme: dark; }
body { background: var(--paper); color: var(--ink); font: 15px/1.55 var(--sans); padding-inline: 16px; padding-block: 28px 48px; }
main { max-width: 860px; margin: 0 auto; display: grid; gap: 36px; }
header { display: grid; gap: 4px; }
.eyebrow { font: 500 12px var(--mono); letter-spacing: .08em; text-transform: uppercase; color: var(--accent); }
h1 { font: 600 30px/1.15 var(--cond); margin: 0; text-wrap: balance; }
h2 { font: 600 20px/1.2 var(--cond); margin: 0 0 12px; letter-spacing: .01em; }
h3 { font: 600 15px var(--sans); margin: 18px 0 6px; }
a { color: var(--accent); }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.muted { color: var(--muted); } .small { font-size: 13px; }
.lede { margin: 0 0 14px; font-weight: 500; }
.tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 0 0 14px; }
.tiles div { border-top: 2px solid var(--line); padding-top: 6px; }
.tiles dt { font: 500 12px var(--mono); text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
.tiles dd { margin: 0; font: 600 34px/1.1 var(--cond); font-variant-numeric: tabular-nums; }
.bar { display: flex; height: 10px; border-radius: 5px; overflow: hidden; background: var(--rest); }
.bar .done { background: var(--done); } .bar .test { background: var(--test); } .bar .prog { background: var(--prog); }
ul.rows { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
.row { display: grid; grid-template-columns: 11rem minmax(0, 1fr); gap: 2px 14px; padding: 10px 0; border-bottom: 1px solid var(--line); }
.ref { font: 500 13px var(--mono); overflow-wrap: anywhere; }
.title { min-width: 0; }
.meta { grid-column: 2; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 13px; }
.pill { border: 1px solid var(--line); border-radius: 999px; padding: 0 8px; color: var(--muted); }
.chip { border-radius: 4px; padding: 0 6px; font-weight: 500; }
.chip.bad { color: var(--bad); background: var(--bad-bg); } .chip.warn { color: var(--warn); background: var(--warn-bg); } .chip.info { color: var(--info); background: var(--info-bg); }
.owner { margin-left: auto; color: var(--muted); }
.empty { color: var(--muted); margin: 0; }
.notes { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 4px 18px 14px; }
.notes ul { padding-left: 20px; margin: 4px 0; } .notes p { margin: 8px 0; max-width: 68ch; }
code { font: 13px var(--mono); }
footer { color: var(--muted); font-size: 13px; }
@media (max-width: 560px) {
  .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .row { grid-template-columns: minmax(0, 1fr); } .meta { grid-column: 1; } .owner { margin-left: 0; }
}
</style>
<main>
<header>
  <span class="eyebrow">Sprint board</span>
  <h1>${esc(title)}</h1>
  <span class="muted small">Updated ${when(Date.parse(report.generatedAt))} · <a href="${esc(report.board.url)}">Open the board</a></span>
</header>
<section><h2>Sprint</h2>${sprint}</section>
<section><h2>Needs attention</h2>${flagged.length ? `<ul class="rows">${flagged.map((i) => row(i, report.owners, chips(i))).join('')}</ul>` : empty}</section>
<section><h2>Ready to merge</h2>${ready.length ? `<ul class="rows">${ready.map((i) => row(i, report.owners)).join('')}</ul>` : empty}</section>
<section><h2>Ritual notes</h2>${notes?.trim() ? `<div class="notes">${markdown(notes)}</div>` : empty}</section>
${report.errors?.length ? `<section><h2>Could not read</h2><ul>${report.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></section>` : ''}
<footer>Made by the running-scrum skill from the board and open pull requests. It never merges, deploys or tags.</footer>
</main>
`;
}

function main() {
  const argv = process.argv.slice(2), f = {};
  for (let i = 0; i < argv.length; i += 2) f[argv[i].replace(/^--/, '')] = argv[i + 1];
  if (!f.report || !f.out) { console.error('Usage: status-page.mjs --report report.json [--notes notes.md] --out page.html'); process.exit(2); }
  const report = JSON.parse(readFileSync(f.report, 'utf8'));
  writeFileSync(f.out, render(report, f.notes ? readFileSync(f.notes, 'utf8') : ''));
  console.log(`Page written to ${f.out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

#!/usr/bin/env node
// Visual sweep of a LOCAL web app: every route × role × locale × viewport.
// Saves full-page screenshots and runs automatic checks. Refuses non-local hosts.
//
// Usage: node visual-sweep.mjs --config .agents/visual-test.json --out .visual-tests
//          [--only <text>] [--roles a,b] [--locales en,ar] [--viewports phone,desktop]
// Exit 0: no automatic findings. 1: findings (see manifest.json). 2: setup error.

import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '10.0.2.2']);

const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(`--${name}`); return i === -1 ? null : argv[i + 1]; };
const list = (name) => arg(name)?.split(',').map((s) => s.trim()).filter(Boolean) ?? null;
const die = (msg) => { console.error(msg); process.exit(2); };

const configPath = arg('config') ?? die('Missing --config');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const allowed = new Set([...LOCAL_HOSTS, ...(config.allowedHosts ?? [])]);
const base = new URL(config.baseUrl);
if (!allowed.has(base.hostname)) die(`Refusing ${base.hostname}: visual tests run on a local stack only.`);

function loadPlaywright() {
  for (const from of [process.cwd(), join(homedir(), '.cache', 'cleverways')]) {
    try { return createRequire(join(from, 'noop.js'))('playwright'); } catch {}
  }
  die('Playwright not found. Run: npm i --prefix ~/.cache/cleverways playwright && npx --prefix ~/.cache/cleverways playwright install chromium');
}
const { chromium } = loadPlaywright();

const only = arg('only');
const roles = list('roles');
const locales = config.locales.filter((l) => !list('locales') || list('locales').includes(l.code));
const viewports = config.viewports.filter((v) => !list('viewports') || list('viewports').includes(v.name));
const routes = config.routes.filter((r) =>
  (!roles || roles.includes(r.role)) && (!only || `${r.name} ${r.path}`.toLowerCase().includes(only.toLowerCase())));

const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = resolve(arg('out') ?? '.visual-tests', runId);
mkdirSync(outDir, { recursive: true });

// "label:Phone", "placeholder:…", "testid:…", "role:button:Sign in", "text:…", or a CSS/Playwright selector.
function locate(page, sel) {
  const [kind, ...rest] = sel.split(':');
  const value = rest.join(':');
  switch (kind) {
    case 'label': return page.getByLabel(value);
    case 'placeholder': return page.getByPlaceholder(value);
    case 'testid': return page.getByTestId(value);
    case 'text': return page.getByText(value);
    case 'role': { const [role, ...name] = rest; return page.getByRole(role, name.length ? { name: name.join(':'), exact: true } : {}); }
    default: return page.locator(sel);
  }
}

const pick = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
const fillVars = (s, vars) => String(s).replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');

function guardRequests(page) {
  page.on('request', (req) => {
    if (!['fetch', 'xhr', 'document'].includes(req.resourceType())) return;
    const host = new URL(req.url()).hostname;
    if (!allowed.has(host)) die(`Refusing: the app called ${host}. Point it at the local API before testing.`);
  });
}

async function login(browser, role) {
  const steps = config.roles?.[role]?.login;
  if (!steps) return undefined;
  const context = await browser.newContext();
  const page = await context.newPage();
  guardRequests(page);
  const vars = {};
  for (const [i, step] of steps.entries()) {
    try { await runStep(page, step, vars); } catch (e) {
      die(`Login for role "${role}" failed at step ${i + 1} ${JSON.stringify(step)}: ${String(e.message).split('\n')[0]}`);
    }
  }
  const state = await context.storageState();
  await context.close();
  return state;
}

async function runStep(page, step, vars) {
  if (step.goto) await page.goto(new URL(step.goto, base).href);
  if (step.fill) await locate(page, step.fill).fill(fillVars(step.value, vars), { timeout: 15000 });
  if (step.click) {
    const capture = step.captureResponse;
    // Read the body as soon as the response arrives; a navigation right after discards it.
    const body = capture && new Promise((done) => {
      const onResponse = async (r) => {
        if (!r.url().includes(capture.url)) return;
        page.off('response', onResponse);
        done(await r.json().catch(() => null));
      };
      page.on('response', onResponse);
    });
    await locate(page, step.click).click({ timeout: 15000 });
    if (body) vars[capture.as] = pick(await body, capture.path);
  }
  if (step.waitForURL) await page.waitForURL(step.waitForURL, { timeout: 20000 });
}

async function check(page, expectedDir) {
  return page.evaluate((dir) => {
    const found = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) found.push({ check: 'horizontal-overflow', detail: `page is ${doc.scrollWidth}px wide in a ${doc.clientWidth}px viewport` });
    if (dir && (doc.dir || 'ltr') !== dir) found.push({ check: 'text-direction', detail: `dir="${doc.dir || 'ltr'}", expected "${dir}"` });
    for (const img of document.images) if (img.complete && img.naturalWidth === 0) found.push({ check: 'broken-image', detail: img.currentSrc || img.src });
    const keyLike = /\b[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+){2,}\b/g;
    const keys = (document.body.innerText.match(keyLike) ?? []).filter((k) => /[A-Z_]/.test(k));
    for (const k of new Set(keys)) found.push({ check: 'raw-translation-key', detail: k });
    return found;
  }, expectedDir);
}

const browser = await chromium.launch();
const manifest = { runId, baseUrl: config.baseUrl, results: [] };
const states = {};

for (const route of routes) {
  if (!(route.role in states)) states[route.role] = await login(browser, route.role);
  for (const locale of locales) {
    for (const vp of viewports) {
      const context = await browser.newContext({ storageState: states[route.role], viewport: { width: vp.width, height: vp.height }, locale: locale.code });
      const set = config.setLocale ?? {};
      if (set.cookie) await context.addCookies([{ name: set.cookie, value: locale.code, url: base.origin }]);
      if (set.localStorage) await context.addInitScript(([k, v]) => localStorage.setItem(k, v), [set.localStorage, locale.code]);
      const page = await context.newPage();
      guardRequests(page);
      const findings = [];
      page.on('console', (m) => { if (m.type() === 'error') findings.push({ check: /MISSING_MESSAGE/.test(m.text()) ? 'missing-translation' : 'console-error', detail: m.text().slice(0, 300) }); });
      page.on('pageerror', (e) => findings.push({ check: 'page-error', detail: String(e).slice(0, 300) }));
      page.on('response', (r) => { if (r.status() >= 400) findings.push({ check: 'http-error', detail: `${r.status()} ${r.request().method()} ${r.url()}` }); });
      page.on('requestfailed', (r) => findings.push({ check: 'request-failed', detail: `${r.failure()?.errorText} ${r.url()}` }));

      const url = new URL(route.path, base);
      if (set.query) url.searchParams.set(set.query, locale.code);
      try {
        await page.goto(url.href, { waitUntil: 'networkidle', timeout: 30000 });
      } catch (e) {
        findings.push({ check: 'load-timeout', detail: String(e).split('\n')[0] });
      }
      findings.push(...await check(page, locale.dir));
      const slug = `${route.role}-${route.path.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home'}-${locale.code}-${vp.name}`;
      const screenshot = join(outDir, `${slug}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      manifest.results.push({ role: route.role, name: route.name, path: route.path, locale: locale.code, viewport: vp.name, screenshot, findings });
      console.log(`${findings.length ? '✗' : '✓'} ${slug}${findings.length ? ` (${findings.map((f) => f.check).join(', ')})` : ''}`);
      await context.close();
    }
  }
}
await browser.close();

writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
const total = manifest.results.reduce((n, r) => n + r.findings.length, 0);
console.log(`\n${manifest.results.length} captures, ${total} automatic findings → ${join(outDir, 'manifest.json')}`);
process.exit(total ? 1 : 0);

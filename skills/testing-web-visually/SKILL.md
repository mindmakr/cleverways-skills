---
name: testing-web-visually
description: Use when asked to test, review or QA web screens visually, check layouts across languages, text directions or screen sizes, sweep UI before a release, or look for visual regressions in a web app running locally.
---

# Testing web visually

The sweep runs only against the local stack with seeded data. Seeded logins are local fixtures, so using them is safe. The script refuses any host that is not local, and so do you.

**Required:** the project-profile skill (its "Local run" section), the reporting-visual-defects skill for issues, and the writing-plainly skill.

## Set up once

```
npm i --prefix ~/.cache/cleverways playwright
npx --prefix ~/.cache/cleverways playwright install chromium
```

The project keeps its sweep config in `.agents/visual-test.json`, and `config-template.json` in this skill's folder is the starting point. To create it, take the URLs, locale mechanism, seeded logins and routes from the profile and the code, and ask the user for anything they don't give. Add `.visual-tests/` to the project's `.gitignore`.

## Steps

1. **Start the local stack.** Follow the profile's Local run steps in order: database, migrate, seed, servers. Check each URL answers with `curl -sI <url>`. Never point the sweep at test, demo or production.
2. **Scope.** Use the screens the user names. If they name none, map the changed files (`git diff --name-only <base>...HEAD`) to routes. For a release, sweep all routes. If it is still unclear, ask.
3. **Sweep.**
   ```
   node ${CLAUDE_SKILL_DIR}/scripts/visual-sweep.mjs --config .agents/visual-test.json --out .visual-tests [--only <text>] [--roles a,b] [--locales en,ar] [--viewports phone,desktop]
   ```
   Outside Claude Code, `${CLAUDE_SKILL_DIR}` is this skill's folder. Exit 1 means the automatic checks found something (see the table below).
4. **Review the screenshots.** Open every in-scope screenshot for each locale, at phone and desktop sizes. Look for:
   - clipped or overlapping text;
   - wrong alignment or unmirrored layout in right-to-left locales;
   - English left in other locales;
   - wrong currency or date formats;
   - empty or broken states;
   - spacing that differs from sibling screens.

   Record a finding only when you can point at it in the screenshot.
5. **Trace.** Cite each finding's component or string as the investigating-issues skill does: a pinned permalink, the symbol, and the quoted code. A finding you could not trace is still reported, marked "Not traced".
6. **Report** with the reporting-visual-defects skill.
7. **Reply** in six lines or fewer: the run folder, what was covered (screens × locales × sizes), the issues opened or updated, and what was not covered.

## Automatic checks

| Check | Catches |
|---|---|
| `horizontal-overflow` | The page is wider than the viewport, so it scrolls sideways on a phone |
| `text-direction` | `dir` does not match the locale (right-to-left not applied) |
| `raw-translation-key`, `missing-translation` | A key such as `admin.ewa.title` shown instead of text, or `MISSING_MESSAGE` in the console |
| `console-error`, `page-error` | JavaScript errors |
| `http-error`, `request-failed` | API responses of 400 or above, and failed requests |
| `broken-image` | Images that did not load |
| `load-timeout` | The page never settled |

## Stop

| Thought | Do instead |
|---|---|
| "The test server is quicker" | Local only. The script refuses anything else. |
| "I'll use a real account" | Use seeded accounts from the profile only. |
| "Desktop looks fine" | Check phone size and every right-to-left locale too. |
| "No automatic findings, so it's done" | Step 4 is the review. The checks only catch the obvious. |

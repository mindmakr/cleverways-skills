# running-scrum Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `running-scrum` skill (six rituals, report/rank/stale scripts, status page) and the board.mjs fixes it depends on.

**Architecture:** `board.mjs` stays the one owner of profile parsing and board access; it gains the extra item fields, PR lookup fix, review-state reader and the PR sprint rule. `running-scrum/scripts/scrum.mjs` builds a report from `openBoard()` plus one GraphQL pass for PR health, and exposes pure functions (`flagsFor`, `rank`, `parseEvidence`, `staleVerdict`) that tests drive with fixtures. `status-page.mjs` renders the report and ritual notes to one HTML file. Ritual files tell the agent what to do with the report.

**Tech Stack:** Node 20+ ESM, `node:test`, `gh` CLI (GraphQL), git. No npm dependencies (repo has no package.json).

**Spec:** `docs/superpowers/specs/2026-09-30-running-scrum-design.md`

## Global Constraints

- SKILL.md under 500 words; frontmatter `name` + `description` starting "Use when…".
- Keep skills generic: project facts come from `.agents/project-profile.md`.
- Never duplicate a rule: reference the owning skill.
- Scripts in `scripts/` of their skill, called via `node`; no npm dependencies.
- Writing style per `skills/writing-plainly`.
- The skill never approves, merges, deploys, tags or publishes.
- `claude plugin validate .` passes before push.

## Review Focus

1. A ref written `owner/repo#n` for a PR: `show` and `set` must find the existing card (the bug found 2026-09-30). Test in Task 1.
2. A board with no current sprint (between sprints, or kanban): report and rank must not crash; flags that need a sprint are skipped. Test in Task 2.
3. An issue with no citations at all, and one citing a file that no longer exists: stale returns `no-evidence` / `changed` without throwing. Test in Task 3.
4. A PR with no review tracker comment: `review-behind-head` is flagged, not an exception. Test in Task 2.
5. Notes containing `<script>` or HTML: the status page escapes them. Test in Task 4.

---

### Task 1: board.mjs fixes and shared helpers

**Files:**
- Modify: `skills/setting-up-project-tracking/scripts/board.mjs`
- Create: `skills/setting-up-project-tracking/scripts/test/board.test.mjs`

**Interfaces:**
- Produces: `findItem(board, ref) → item | undefined` (tries `/issues/` and `/pull/` forms); `urlOf(ref)` exported; `reviewState(repo, number) → state | null` (parses the reviewing-prs tracker); `readProfile()` also returns `owners {repo: login}`, `statusPage`, `thresholds {stuck, stale, abandoned}` (days, defaults 3/30/30), `localPaths {repo: absolute path}`; ITEM query adds `updatedAt`, Size, issue `createdAt labels assignees(logins) issueDependenciesSummary{blocking}`, PR `createdAt updatedAt`.
- `sync`: an open PR with no Sprint gets its first linked issue's sprint, else the current sprint.

- [ ] Write failing tests: `findItem` finds a PR card from `owner/repo#n`; `setItems` on an existing PR keeps Status (stub `gql` via injected board with items map and a recording edit); `readProfile` parses Owners, Status page, Thresholds and local paths from a temp profile.
- [ ] Run `node --test skills/setting-up-project-tracking/scripts/test` — expect failures.
- [ ] Implement; `ensureItem` and `show` use `findItem`; readyToMerge uses `reviewState`.
- [ ] Tests pass. Commit "board.mjs: find PR cards by owner/repo#n, keep Status on re-add, PRs take a sprint".

### Task 2: scrum.mjs report and rank

**Files:**
- Create: `skills/running-scrum/scripts/scrum.mjs`, `skills/running-scrum/scripts/test/scrum.test.mjs`, `skills/running-scrum/scripts/test/fixtures/board.json`

**Interfaces:**
- Consumes: `readProfile`, `openBoard`, `reviewState`, `urlOf` from board.mjs.
- Produces: `toItem(boardItem, prHealth, review) → reportItem` (spec's Report JSON item); `flagsFor(item, {now, thresholds, sprint}) → string[]`; `rank(items, releaseOrder) → [{...item, reason}]`; `sprintStats(items, board, now) → {current, planned, done, onTest, previousDone}`; CLI `report [--board] [--profile]`, `rank`.
- Release order = the Release field's option order.

- [ ] Failing tests on fixture: flags (stuck, unassigned, conflict, checks-failing, review-behind-head incl. no tracker, abandoned, not-started); no current sprint; rank order covering each rule step and determinism.
- [ ] Implement pure functions, then CLI fetching (one GraphQL query per repo for open PR health).
- [ ] Tests pass; `node skills/running-scrum/scripts/scrum.mjs report --profile <payday>` returns JSON. Commit.

### Task 3: stale check

**Files:**
- Modify: `skills/running-scrum/scripts/scrum.mjs`; Test: `skills/running-scrum/scripts/test/stale.test.mjs`

**Interfaces:**
- Produces: `parseEvidence(texts[]) → {files[], shas[], evidenceAt}`; `staleVerdict({citations, changed[], evidenceAt, now, staleDays}) → 'changed'|'unchanged'|'no-evidence'`; `changedSince(repoPath, base, since, files) → [{sha, subject}]`; CLI `stale <ref>`.

- [ ] Failing tests: parseEvidence on sample bodies (path:line, backticked paths, full and short SHAs, commit URLs); staleVerdict truth table; changedSince on a temp git repo (changed, unchanged, deleted file).
- [ ] Implement. Tests pass. Commit.

### Task 4: status page

**Files:**
- Create: `skills/running-scrum/scripts/status-page.mjs`, `skills/running-scrum/scripts/test/status-page.test.mjs`

**Interfaces:**
- Produces: `render(report, notesMarkdown) → html`; CLI `--report f --notes f --out f`.

- [ ] Failing tests: empty report renders all sections with "Nothing here"; full report lists blockers with owners and ready PRs; notes with `<script>` are escaped; has `prefers-color-scheme` and viewport meta.
- [ ] Implement. Tests pass. Commit.

### Task 5: SKILL.md, rituals and docs

**Files:**
- Create: `skills/running-scrum/SKILL.md`, `skills/running-scrum/rituals/{standup,planning,refinement,pr-triage,sprint-close,release}.md`
- Modify: `skills/setting-up-project-tracking/SKILL.md`, `skills/project-profile/template.md`, `README.md`, spec (release order + sprint stats wording)

- [ ] Write files; SKILL.md word count under 500 (`wc -w`).
- [ ] `claude plugin validate .` passes. Commit.

### Task 6: live validation on PayDay, PR, merge

- [ ] Add `Owners:` to the PayDay mobile profile only if the user's rule (mobile → Mughira) is all that is known; web owner left unset.
- [ ] Run `scrum.mjs report`, `rank`, `stale` on three PayDay issues, `board.mjs show` on a PR, `sync --dry`; run the standup ritual in `--dry`; render and publish the status page.
- [ ] Open the PR with the dry-run output; merge after checks pass (user authorised merge on 2026-09-30).

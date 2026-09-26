---
name: setting-up-project-tracking
description: Use when asked to set up GitHub project tracking for a product's repos — a GitHub Project (v2) board, sprints, backlog, scrum or kanban board, roadmap, bug triage or release-notes views — or to bring an existing board up to that setup, to sync a board that has drifted from its issues and PRs, or when gh reports "missing required scopes [read:project]".
---

# Setting up project tracking

One GitHub Project (v2) holds every repo the profile lists. Milestones stay with the planning skills, one per epic. Releases are a **Release** field, and sprints are a **Sprint** iteration field.

**Required:** the project-profile skill (repos, PR base branch, tag format, priority labels) and the writing-plainly skill.

## Steps

1. **Read the profile:** repos (each gets a Platform named after its role: Backend, Web, Mobile), PR base branch, tag format. A Tracking section means the board exists: reuse its title and settings.
2. **Read GitHub:** `gh project list --owner <owner>`, labels, open issues per repo.
3. **Ask only what is still open**, in one question:
   - sprint length and first start date, or kanban (no sprints);
   - the release names, in the tag format, for example `v1.0.0` and `v1.1.0`. Set no due dates nobody has agreed.
4. **Scope.** If `gh auth status` lacks `project`, ask the user to run `! gh auth refresh -h github.com -s project`. Re-check, and continue only once `'project'` is listed.
5. **Dry run.** Show the plan it prints and ask once: create it, adjust it, or stop.
   ```
   node scripts/setup.mjs --owner O --title "Product" --repo api=Backend --repo web=Web \
     --release v1.0.0 --release v1.1.0 --sprint-start 2026-09-27 --sprint-days 14 \
     --sprint-priorities High,Medium --release-config <PR base> --dry
   ```
   The script header lists every option. `--dry` creates nothing.
6. **Run it** without `--dry`. It never merges a PR.
7. **Releases.** Assign each open issue with `--assign-release v1.0.0=web#12,api#40` (user-visible defects: next release; internal tooling: later). Say which went where.
8. **Record it** in the profile's Tracking section: `Board: <project URL>` and `Platform per repo: <repo> → <Platform>, …`. The board script reads both. Commit through the project's PR flow.
9. **Reply** with the board link, issue counts per sprint, and what only the web UI can do:
   - delete the default "View 1";
   - Roadmap → View options → Dates: pick Sprint, or Start and Target;
   - Workflows: turn on "Auto-add to project" for each repo, and turn off "Item closed" and "Pull request merged", which jump items to Done and skip On test;
   - if the first sprint starts in the future, the Scrum board stays empty until that date;
   - on a board made before the Pull requests view: show the "Pull request" field on the Scrum board cards (View → Fields), and add `is:issue` to the other views' filters.

## Keeping it live

Every skill moves the board at the moment it acts, with `board.mjs` (from another skill: `node ${CLAUDE_SKILL_DIR}/../setting-up-project-tracking/scripts/board.mjs`). It reads the board from the profile, adds an item that is missing, and does nothing when the profile names no board. The script header lists every command.

| When | Who | Board |
|---|---|---|
| Issue filed | investigating-issues, reporting-visual-defects | added, Backlog, Priority from its label |
| Plan created | planning-work | Size, Platform; Ready when nothing it depends on is open, else Backlog |
| Work starts | fixing-issues | In progress, current sprint, assignee; the parent follows |
| PR opened | fixing-issues | issue In review; the PR on the board, In review, with no sprint |
| Review passed | reviewing-prs | issue and PR Ready to merge, until a new commit lands |
| PR merged | reviewing-prs | issue closed by the profile's rule, On test; the PR Done |
| Verified | verifying-fixes | Done, or reopened and Ready |
| Release drafted | writing-release-notes | Release set on every shipped issue |

`board.mjs sync` repairs what people changed by hand. It reads `Fixes` / `Closes` / `Refs #n` from PR bodies, because GitHub links those only on PRs into the default branch. It moves issues to In review or On test, returns reopened ones to Ready, adds missing issues, starts parents, and lists what needs a person (stale sprints, nobody assigned, closed without a PR). Run it with `--dry` first; `--close-merged` also closes issues whose PR merged into the profile's PR base. Run it on request, and at the start of planning-work and writing-release-notes.

## What it sets up

| Piece | Detail |
|---|---|
| Status | Backlog → Ready → In progress → In review → Ready to merge → On test → Done (new project only) |
| Fields | Platform, Priority (from labels), Size, Start, Target, Release, Sprint; Pull request and Fixes, written by `board.mjs sync` |
| Items | Open issues not yet on the board; existing items are left alone |
| Views | Scrum board · current sprint (Status columns, Platform lanes, Pull request on cards), Backlog (by Release), Roadmap (by Milestone), Release notes (On test + Done, by Release), Bug triage (by Priority), Pull requests (open PRs, by repo) |
| `.github/release.yml` | One PR per repo; groups generated notes by label |

## Traps

| Trap | Fact |
|---|---|
| A view came out wrong | The API creates views but cannot edit or delete them. Fix it in the UI; never create a duplicate |
| Board columns | On a board, `vertical_group_by` is the columns and `group_by` the swimlanes |
| New Status or Release option | Replacing a field's options clears every item's value. Add options in the UI |
| New sprint | The API recreates every iteration, which clears each item's Sprint. Save `board.mjs list --json` first and reapply, or add it in the UI |
| Owner | The views API path is `users/O/…` or `orgs/O/…`. The script detects which |

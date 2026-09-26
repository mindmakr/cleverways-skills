---
name: setting-up-project-tracking
description: Use when asked to set up GitHub project tracking for a product's repos — a GitHub Project (v2) board, sprints, backlog, scrum or kanban board, roadmap, bug triage or release-notes views — or to bring an existing board up to that setup, or when gh reports "missing required scopes [read:project]".
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
8. **Record it** in the profile's Tracking section and commit through the project's PR flow.
9. **Reply** with the board link, issue counts per sprint, and what only the web UI can do:
   - delete the default "View 1";
   - Roadmap → View options → Dates: pick Sprint, or Start and Target;
   - Workflows: turn on "Auto-add to project" for each repo;
   - if the first sprint starts in the future, the Scrum board stays empty until that date.

## What it sets up

| Piece | Detail |
|---|---|
| Status | Backlog → Ready → In progress → In review → On test → Done (new project only) |
| Fields | Platform, Priority (from labels), Size, Start, Target, Release, Sprint |
| Items | Open issues not yet on the board; existing items are left alone |
| Views | Scrum board · current sprint (Status columns, Platform lanes), Backlog (by Release), Roadmap (by Milestone), Release notes (On test + Done, by Release), Bug triage (by Priority) |
| `.github/release.yml` | One PR per repo; groups generated notes by label |

## Traps

| Trap | Fact |
|---|---|
| A view came out wrong | The API creates views but cannot edit or delete them. Fix it in the UI; never create a duplicate |
| Board columns | On a board, `vertical_group_by` is the columns and `group_by` the swimlanes |
| New Status or Release option | Replacing a field's options clears every item's value. Add options in the UI |
| Owner | The views API path is `users/O/…` or `orgs/O/…`. The script detects which |

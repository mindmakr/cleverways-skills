# Project profile: <project name>

Shared: <path to another repo's profile, or delete this line>

## Repos

| Role | GitHub | Local path (from this repo) |
|---|---|---|
| <this repo's role> | <owner/repo> | `.` |

## Layers

| Layer | Path | Owns business logic |
|---|---|---|
| <backend / web / mobile / public API / MCP / worker> | <path> | yes / no, display only |

## Non-negotiables

- <rule a change must never break, one line each>

## Commands

| Purpose | Command | Run from |
|---|---|---|
| Typecheck | | |
| Lint | | |
| Unit tests | | |
| Integration tests | | |
| Guardrails / invariants | | |
| Translation check | | |

## Local run

- Start, in order: <database, migrate, seed, backend, web>
- URLs: web <http://localhost:3000>, API <http://localhost:4000>
- Seeded logins: <file:line of the seed>, role → identifier, shared password or how the local OTP is shown
- Web visual config: `.agents/visual-test.json` (locale set by <cookie / query / storage>)
- Mobile: app id <id>, run with <command>, API URL variable <NAME> = <http://10.0.2.2:port on Android>, language switched on <screen>, devices <small, large>, flows in `.maestro/visual/`

## Locales

- Base locale: <en>
- Locales: <en, ar, ...>, direction: <ar: RTL>
- Files: <dir per repo>
- Format: <ICU (next-intl) / i18next {{var}}>
- To add a locale, also register it in: <config files, switcher, formatters, fonts, RTL list, server allowlist>
- Copy under approval (do not change without the owner): <email / SMS / legal>

## Git flow

- PR base branch: <branch>
- Branch from: <base, or the previous PR's branch when stacking>
- Never: <push to deploy branches, merge without an ask>
- Reviewers: <GitHub handles asked to review every PR; the PR's author is skipped>
- Issues close when: <merged into which branch, by whom>

## Issues

- Title prefix: <[web] / [mobile]>
- Labels: <bug>, priorities <name: colour>
- Linked-issue order: <e.g. backend, then web, then mobile>

## Releases

- Tags: <format>
- Notes go to: <GitHub release per repo + stakeholder page>
- Stakeholder audience: <who>, exclude: <implementation detail, PR numbers>
- Environments: <names, which branch deploys where, who owns env files, where env vars are documented>
- Deploy order: <e.g. migrations, backend, web, mobile>
- Testers: <where test accounts come from, which locales and sizes to check>
- Rollback: <how to redeploy the previous version, and whether migrations are reversible>

## Tracking

- Board: <https://github.com/users|orgs/<owner>/projects/<n>>, one board for every repo above
- Platform per repo: <repo> → <Backend / Web / Mobile>, <repo> → <…>. Write "<A> or <B> (by layer)" for a repo that holds two, and the board script leaves Platform to the caller
- Releases: Release field values <v1.0.0, v1.1.0>. Milestones are epics (planning-epics)
- Sprints: <N days, starting <day>, Sprint 1 from YYYY-MM-DD> or kanban
- Owners: <repo> → <GitHub login>, <repo> → <…>. running-scrum assigns unowned issues and PRs to them
- Status page: <URL of the running-scrum status page, once published>
- Thresholds: stuck 3d, stale 30d, abandoned 30d (optional; these are the defaults running-scrum uses)
- Agents: <agent login> takes <which issues>, for example "Copilot takes mobile issues that are not High or security, and Low issues elsewhere that are not security" (optional; running-scrum standup hands those issues over)

## Terms

| Say | Never say | Why |
|---|---|---|

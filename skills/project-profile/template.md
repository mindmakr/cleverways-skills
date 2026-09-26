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

## Terms

| Say | Never say | Why |
|---|---|---|

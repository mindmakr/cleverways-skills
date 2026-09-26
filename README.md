# cleverways-skills

Agent skills for everyday engineering work. They are generic: each project describes itself in `.agents/project-profile.md`, and the skills read that file.

| Skill | Use it to |
|---|---|
| `investigating-issues` | Find the root cause of a bug with code evidence, check every layer and repo for the same pattern, and open linked issues |
| `resolving-issues` | Fix an issue and every issue linked to it, test-first, one PR per repo |
| `writing-release-notes` | Draft a GitHub release per repo, plus a plain-language page for stakeholders |
| `aligning-translations` | Check locale parity, fix missing or untranslated keys, add a language |
| `testing-web-visually` | Sweep a locally running web app with Playwright across roles, locales and screen sizes; review the screenshots |
| `testing-mobile-visually` | Sweep a mobile app (Expo, React Native, Flutter, native) on a local emulator with Maestro |
| `reporting-visual-defects` | Turn visual findings into deduplicated GitHub issues, with pinned screenshots |
| `project-profile` | Create or read the project profile the other skills depend on |
| `writing-plainly` | Keep every reply, issue and note short and specific |

## Install

### Claude Code: for everyone in a project

From the project's root, run:

```
claude plugin marketplace add mindmakr/cleverways-skills --scope project
claude plugin install cleverways@cleverways --scope project
```

Commit `.claude/settings.json`. Teammates get the skills once they trust the folder. Invoke a skill as `/cleverways:investigating-issues`, or just describe the task.

### Codex, Gemini CLI, Copilot CLI and other agents

```
git clone https://github.com/mindmakr/cleverways-skills
node cleverways-skills/scripts/install-agents.mjs
```

This copies the skills into `~/.agents/skills`. Use `--target <dir>` for an agent that reads a different folder. Re-run it after `git pull`.

## Before you start

- `gh` CLI signed in with access to every repo the profile lists: `gh auth login`, then `gh auth setup-git`.
- Related repos cloned side by side, at the local paths the profile gives, so skills can search them.
- Node 18 or later, for the scripts.
- Visual tests: `npm i --prefix ~/.cache/cleverways playwright && npx --prefix ~/.cache/cleverways playwright install chromium`. For mobile, install [Maestro](https://docs.maestro.dev) and put `adb` on PATH.
- Visual tests run only against a local stack with seeded data. The scripts refuse any other host.

## Use

Type the slash command, or describe the task in words; the agent picks the skill from its description.

| Skill | Say | You get |
|---|---|---|
| investigating-issues | `/cleverways:investigating-issues` then the report, screenshots, or `#123` | One issue per affected repo, cross-linked, with pinned code citations. No code changes. |
| resolving-issues | `/cleverways:resolving-issues #123` | A failing test, then the fix, the checks run, and one PR per repo. Nothing is merged. |
| writing-release-notes | `/cleverways:writing-release-notes since the last promotion` | Draft GitHub releases (changes, for testers, for devops) and a stakeholder page. |
| aligning-translations | `/cleverways:aligning-translations` or "add French" | A parity table per repo and locale, then the fixes. |
| testing-web-visually | `/cleverways:testing-web-visually the declined screens` | Screenshots per role, locale and size, automatic checks, a visual review, and `visual-test` issues. Local stack only. |
| testing-mobile-visually | `/cleverways:testing-mobile-visually` | The same for the app, on a local emulator. |
| project-profile | "set up the project profile" | `.agents/project-profile.md`, filled from the repo plus your answers. |

Other agents: name the skill in plain words, for example "use the investigating-issues skill on this report".

When a skill needs a decision, it asks one question with options and a recommendation. Answer it, and the skill carries on.

## Set up a project

Ask your agent: "set up the project profile". The `project-profile` skill fills `.agents/project-profile.md` from the repo and asks about anything the repo can't answer. Commit the file.

## Update

Claude Code: `/plugin marketplace update cleverways`. Other agents: `git pull`, then re-run the install script.

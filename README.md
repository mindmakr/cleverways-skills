# cleverways-skills

Agent skills for everyday engineering work. They are generic: each project describes itself in `.agents/project-profile.md`, and the skills read that file.

| Skill | Use it to |
|---|---|
| `investigating-issues` | Find the root cause of a bug with code evidence, check every layer and repo for the same pattern, and open linked issues |
| `resolving-issues` | Fix an issue and every issue linked to it, test-first, one PR per repo |
| `planning-epics` | Plan an epic: a milestone, an epic issue, features as sub-issues, tasks under each |
| `planning-features` | Plan a feature, on its own or inside an epic, with a task for every layer and repo it touches |
| `planning-replacements` | Plan replacing one behaviour or implementation with another: inventory, cutover, and removal of the old way |
| `planning-refactors` | Plan an improvement that leaves behaviour unchanged: behaviour lock first, measured before and after |
| `planning-work` | The shared steps the planning skills use: investigate, draft, confirm once, create on GitHub |
| `verifying-fixes` | Check a fixed issue's acceptance items with evidence, then close or reopen it |
| `reviewing-prs` | Review a PR against its linked issues and the project rules until it is ready to merge; findings and questions are tracked in one comment on the PR |
| `writing-release-notes` | Draft a GitHub release per repo, plus a plain-language page for stakeholders |
| `aligning-translations` | Check locale parity, fix missing or untranslated keys, add a language |
| `testing-web-visually` | Sweep a locally running web app with Playwright across roles, locales and screen sizes; review the screenshots |
| `testing-mobile-visually` | Sweep a mobile app (Expo, React Native, Flutter, native) on a local emulator with Maestro |
| `reporting-visual-defects` | Turn visual findings into deduplicated GitHub issues, with pinned screenshots |
| `project-profile` | Create or read the project profile the other skills depend on |
| `writing-plainly` | Keep every reply, issue and note short and specific |

## How they fit

```
plan            planning-epics / -features / -replacements / -refactors   → milestone + task issues
investigate     investigating-issues                                        → linked issues, one per repo
build           resolving-issues                                            → test-first fix, one PR per repo
review          reviewing-prs                                               → verdict + tracking comment, round per new commit
fix review      resolving-issues #<pr>                                      → open findings fixed on the same branch, replies, next round
verify          verifying-fixes                                             → acceptance items checked with evidence → close or reopen
test            testing-web-visually / testing-mobile-visually              → screenshots → reporting-visual-defects → visual-test issues
ship            writing-release-notes                                       → GitHub releases (changes, testers, devops) + stakeholder page
always          project-profile, writing-plainly, aligning-translations
```

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
- Web visual tests: `node skills/testing-web-visually/scripts/setup.mjs`. It installs Playwright and Chromium into `~/.cache/cleverways`.
- Mobile visual tests: `node skills/testing-mobile-visually/scripts/setup.mjs --start-emulator <avd>`. It:
  - checks Java 17+ (Android Studio's bundled JDK counts), `adb`, the emulator and your AVDs;
  - installs Maestro into `~/.maestro`;
  - cold-boots the emulator.

  It never edits PATH, because the sweep finds every tool itself. Create AVDs in Android Studio > Device Manager.
- In a Claude Code session, ask "set up visual testing" and the skill runs the setup script.
- Visual tests run only against a local stack with seeded data. The scripts refuse any other host.

## Use

Type the slash command, or describe the task in words; the agent picks the skill from its description.

| Skill | Say | You get |
|---|---|---|
| investigating-issues | `/cleverways:investigating-issues` then the report, screenshots, or `#123` | One issue per affected repo, cross-linked, with pinned code citations. No code changes. |
| resolving-issues | `/cleverways:resolving-issues #123` | A failing test, then the fix, the checks run, and one PR per repo. Nothing is merged. |
| planning-epics / -features / -replacements / -refactors | `/cleverways:planning-epics early settlement for employers` | A draft plan to confirm once, then a milestone, a parent issue and `task` sub-issues on GitHub. No code changes. |
| reviewing-prs | `/cleverways:reviewing-prs #565` | A verdict (READY TO MERGE / NEEDS FIXES / BLOCKED ON), inline comments for new findings, and a tracking comment updated each round. Re-running after new commits reviews only the new commits; it never merges. |
| resolving-issues (review fixes) | `/cleverways:resolving-issues #565` | The PR's open review findings fixed on its branch, a `Fixed in <sha>` reply on each, then a new review round. |
| verifying-fixes | `/cleverways:verifying-fixes #567` | A pass/fail table per acceptance item with evidence, then the issue closed or reopened. |
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

# cleverways-skills

Agent skills for everyday engineering work. They are generic: each project describes itself in `.agents/project-profile.md`, and the skills read that file.

| Skill | Use it to |
|---|---|
| `investigating-issues` | Find the root cause of a bug with code evidence, check every layer and repo for the same pattern, and open linked issues |
| `resolving-issues` | Fix an issue and every issue linked to it, test-first, one PR per repo |
| `writing-release-notes` | Draft a GitHub release per repo, plus a plain-language page for stakeholders |
| `aligning-translations` | Check locale parity, fix missing or untranslated keys, add a language |
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

## Set up a project

Ask your agent: "set up the project profile". The `project-profile` skill fills `.agents/project-profile.md` from the repo and asks about anything the repo can't answer. Commit the file.

## Update

Claude Code: `/plugin marketplace update cleverways`. Other agents: `git pull`, then re-run the install script.

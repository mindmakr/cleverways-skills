---
name: project-profile
description: Use when another cleverways skill needs project facts (repos, layers, commands, locales, git flow, labels, terms), when .agents/project-profile.md is missing or out of date, or when onboarding a repository to these skills.
---

# Project profile

Project facts live in `.agents/project-profile.md` at the repository root, and nowhere else.

## Read it

1. Open `.agents/project-profile.md`, and the profile its `Shared:` line points to, if any.
2. Treat each line as a pointer, not proof. Confirm a fact in the code or with a command before you state it, and cite `path:line`. If they disagree, the code wins: fix the profile in the same change.
3. No profile: create one (below) first.

## Run its commands

`node ${CLAUDE_SKILL_DIR}/scripts/checks.mjs` runs the Commands table, one line per command. `--only typecheck,unit` picks rows; `--cmd '<command>' --dir <dir>` runs one command, such as one test file. Open a log only for a FAIL.

## Create or update it

1. Copy `template.md` from this skill's folder to `.agents/project-profile.md`.
2. Fill each section from the repository: README, CLAUDE.md, AGENTS.md, package scripts, locale folders, `.github/`, `gh label list`, `git branch -r`, `git tag`.
3. Ask the user what the repository cannot answer (merge policy, labels, release audiences, related repos): one question per decision, recommended option first, with AskUserQuestion in Claude Code.
4. Add one line to CLAUDE.md and AGENTS.md (create AGENTS.md if missing): `Project facts for agents: .agents/project-profile.md`.
5. Commit it through the project's normal PR flow.

## Trim the prompt prefix (optional, once per project)

Every agent turn re-sends the names and descriptions of all enabled plugins, skills and MCP servers. Offer to trim what this project does not use.

1. Run `node ${CLAUDE_SKILL_DIR}/scripts/prefix.mjs report`: counts of plugins, user skills (links included) and MCP servers. If the file `skills/coordinator/scripts/prefix.mjs` exists under the `installPath` of the `coordinator@coordinator` entry in `~/.claude/plugins/installed_plugins.json`, use that prefix check instead and stop here. Otherwise (none ships one yet) continue.
2. Ask the person for the `/context` token figure, or note it was not measured.
3. Keep this plugin, the plugins and servers that the project's `.claude/settings.json` and `.mcp.json` name, and anything the person names (`--keep a,b`). Propose off the rest, with one reason per group.
4. `node ${CLAUDE_SKILL_DIR}/scripts/prefix.mjs draft` prints the merged `.claude/settings.local.json`. Show it. Add `--sync-off` only if the person agrees to drop claude.ai skills, plugins and connectors.
5. Only after approval, run `write --confirm` with the same flags. It also adds the file to `.git/info/exclude`. It never edits `~/.claude/settings.json`.
6. Tell the person: plugin changes load only in a new Claude process (`/clear` keeps the old plugins). To undo, delete the keys or the file.

## What belongs in it

- Facts a skill acts on: paths, commands, names, rules, labels. One line each.
- Shared facts once: one profile holds them, and the other repo links it with `Shared: ../<repo>/.agents/project-profile.md`.
- Never secrets, tokens, private hostnames or customer data. The profile is committed.

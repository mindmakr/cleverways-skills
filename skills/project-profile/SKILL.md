---
name: project-profile
description: Use when another cleverways skill needs project facts (repos, layers, commands, locales, git flow, labels, terms), when .agents/project-profile.md is missing or out of date, or when onboarding a repository to these skills.
---

# Project profile

Skills in this pack are generic. Everything specific to a project lives in `.agents/project-profile.md` at the repository root, and nowhere else.

## Read it

1. Open `.agents/project-profile.md`. If it says `Shared:` with a path to another repo's profile, read that one too.
2. Treat each line as a pointer, not proof. Before you state a profile fact as current, confirm it in the code or with a command, and cite `path:line`. When the profile and the code disagree, the code wins: fix the profile in the same change.
3. No profile: create one (below) before continuing the task that needed it.

## Create or update it

1. Copy `template.md` from this skill's folder to `.agents/project-profile.md`.
2. Fill each section from the repository itself: README, CLAUDE.md, AGENTS.md, package scripts, locale folders, `.github/`, `gh label list`, `git branch -r`, `git tag`.
3. For anything the repository cannot answer (merge policy, priority labels, release audiences, related repos), ask the user. One question per decision, with options and your recommendation first. In Claude Code use AskUserQuestion.
4. Add one line to CLAUDE.md and AGENTS.md (create AGENTS.md if missing): `Project facts for agents: .agents/project-profile.md`.
5. Commit it through the project's normal branch and PR flow.

## What belongs in it

- Facts a skill acts on: paths, commands, names, rules, labels. One line each.
- Shared facts once. When two repos share rules, one profile holds them and the other links with `Shared: ../<repo>/.agents/project-profile.md`.
- Never secrets, tokens, private hostnames or customer data. The profile is committed.

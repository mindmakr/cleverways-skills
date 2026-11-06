# Coordinator context

Read by the coordinator skill (github.com/mindmakr/coordinator) at the start of every run in this repo.

## Work flow
- Base branch: `main`. Work goes in through a PR per change; see git log for the PR-merge history.
- Plugin users get changes when their marketplace copy updates, so a merge to `main` ships.

## Checks
- Skill script tests: `node --test skills/*/scripts/test/*.test.mjs` (no database, no services).
- Plugin shape: `claude plugin validate .` (AGENTS.md).

## Risk areas
- Skills must stay generic: project facts belong in each project's `.agents/project-profile.md` (AGENTS.md).
- A rule lives in one skill; others reference it (AGENTS.md).
- SKILL.md under 500 words; scripts in the skill's own `scripts/` (AGENTS.md).
- Changes to reviewing-prs must not lower what a review catches: prove it on a past PR, without posting to it.

## Review
- A blind critic checks each unit against its bar; READY means its tests pass and the plugin validates.

## Standing rules
- None yet. Each run records its own approvals.

## Never
- Post comments, reviews or board changes on another project's PRs while testing a skill (replays are dry runs).

## Isolation
- One worktree per unit under `../cleverways-wt/<unit>`; no `node_modules` needed.

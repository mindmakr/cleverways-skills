# Standup

Goal: the board shows what is true now, and every problem has a named owner.

1. `node ${CLAUDE_SKILL_DIR}/../setting-up-project-tracking/scripts/board.mjs sync --dry`. Read it, then run it without `--dry` (skip that with `--dry`). Copy its "Needs a person" lines into your notes.
2. Re-run `scrum.mjs report` so the flags reflect the synced board.
3. For each flagged open item:

| Flag | Action |
|---|---|
| unassigned | Assign the profile's owner for the repo. No owner in the profile: Needs a person, owner "no repo owner" |
| review-behind-head | Run reviewing-prs on the PR, at most three per standup, oldest head first. Skip PRs with a conflict (they need a rebase first) and Dependabot PRs (pr-triage) |
| conflict, checks-failing | Needs a person, owner = PR author. Dependabot PRs go to pr-triage |
| stuck | Needs a person, owner = assignee, with the status and days in it |
| not-started | Needs a person. Past three quarters of the sprint, ask whether it stays in the sprint |
| abandoned | pr-triage handles it |

4. Run pr-triage.
5. Notes: `## Changed`, `## Needs a person` grouped by owner, `## Questions for you`, then `## Today` with the sprint numbers (planned, in progress, on test, done) and the three highest-ranked Ready issues nobody has started.

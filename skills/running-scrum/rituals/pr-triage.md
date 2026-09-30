# PR triage

Goal: every open PR is moving, or closed with a reason.

For each open PR in the report:

1. **Superseded Dependabot PR.** Close it when a newer open Dependabot PR bumps the same packages, when every package it bumps is now ignored in `.github/dependabot.yml` on the base, or when the base already has those versions. Comment: `Closed by running-scrum: <reason, with the PR or commit>. Dependabot proposes it again if it is still needed.`
2. **Dependabot PR with a conflict**, not superseded: comment `@dependabot rebase`.
3. **Abandoned** (no activity past the abandoned threshold), not Dependabot:
   - No earlier running-scrum warning: comment `No activity for <n> days. Push, or say what it waits on; running-scrum closes it after 7 more days.` and add it to Needs a person.
   - An earlier warning older than 7 days, and nothing since: close it with `Closed by running-scrum: no activity for <n> days. Reopen to continue.` Never delete the branch.
4. **Conflict or failing checks** on any other PR: Needs a person, owner = author, with the failing check names (`gh pr checks <n> -R <repo>`).
5. **No review round on the head**: standup runs reviewing-prs; here only list it.
6. A PR not on the board, or with no sprint: `board.mjs sync` adds it with its issue's sprint.

Under `## PRs` in the notes, list each open PR once: ref, state in five words or fewer, owner, next step.

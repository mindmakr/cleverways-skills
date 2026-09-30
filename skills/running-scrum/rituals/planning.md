# Planning

Goal: the current sprint holds the most important work the team can finish, and every issue in it is still true.

1. If the previous sprint still has open cards, run sprint-close first.
2. `node ${CLAUDE_SKILL_DIR}/scripts/scrum.mjs rank`. Work down that order.
3. Capacity: the previous sprint's done count from the report (`sprint.previousDone`). With no history, ten issues per owner in the profile, or ten when it names none.
4. Take ranked issues that are not in the sprint you plan (current, or next when planning before it starts) until it holds that many. Skip issues In progress or later: sync keeps those in their sprint.
5. Run the stale check (`rituals/stale-check.md`) on each taken issue. Drop the ones that no longer reproduce, and take the next ranked issue in their place.
6. Ask the user once, with the list and the ranking reason for each: take it as is, change it, or stop. Skip the question when the user already gave the list.
7. For each approved issue: `board.mjs set <ref> --sprint current --status Ready` (use `--sprint next` when planning before the sprint starts), and assign the profile's owner when nobody is assigned.
8. Notes: `## Sprint plan` with each issue, its owner and its ranking reason, and `## Left out` with the next five ranked issues and why they did not fit.

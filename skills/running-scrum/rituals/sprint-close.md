# Sprint close

Goal: nothing is lost between sprints, and the team sees what slipped and why.

1. Find the sprint that is ending: the current one on its last day, or the one that just ended (the report's `sprint.previous`).
2. Count its issues: planned, Done, On test, still open.
3. Roll over: every issue in it that is not Done, including On test, moves to the next sprint. Run `board.mjs set <ref> --sprint next` on the last day, or `--sprint current` once the new sprint has started.
4. For each rolled-over issue, one reason from the evidence: its flags, its blocker, waiting on review, waiting on test, or not started.
5. Notes: `## Sprint <n> closed` with the counts, `## Rolled over` (ref, owner, reason), and `## Retro` with at most three observations drawn from the reasons, for example "4 of 6 slips waited on review". State facts; do not grade people.

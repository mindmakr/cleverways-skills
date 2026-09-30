# Refinement

Goal: the next sprint can be planned without surprises.

1. `node ${CLAUDE_SKILL_DIR}/scripts/scrum.mjs rank`.
2. For each open issue not in the current sprint, list what is missing:
   - Priority: set it from a `priority:` label with `board.mjs set <ref> --priority <P>`; with no label, ask.
   - Release: ask, grouping the issues per suggested release. User-visible defects go to the nearest release.
   - Size: ask the owner, under Needs a person.
   - An acceptance list (checkboxes, or a "Done when" section): Needs a person, owner = the issue's author.
3. Likely duplicates: issues whose titles share most words, or that cite the same `path:line`. Ask whether to close one as a duplicate of the other.
4. Stale check (`rituals/stale-check.md`) on the top of the ranked list, as many issues as the next sprint's capacity (see planning).
5. Notes: `## Refined` (what you set), `## Missing` (per issue), `## Duplicates?`, `## Refreshed` (stale check verdicts).

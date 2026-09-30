---
name: running-scrum
description: Use when asked to run the sprint or keep the project board in order, including a standup or board check, sprint planning, backlog refinement, PR triage, closing a sprint or preparing a release, or to act as scrum master for a project's GitHub board.
---

# Running scrum

Run the board through rituals. Each ritual reads the board, acts within the authority below, and updates one status page.

**Required:** the project-profile skill (board, repos, Owners, Thresholds) and the writing-plainly skill. The board belongs to setting-up-project-tracking: move cards only with its `board.mjs`, and never create or restructure the board (`board.mjs sync` adding its own text fields is fine).

## Rituals

`/cleverways:running-scrum <ritual> [--dry]`. With no ritual, run standup.

| Ritual | When | File |
|---|---|---|
| standup | daily, or any time | `rituals/standup.md` |
| planning | sprint start | `rituals/planning.md` |
| refinement | mid-sprint | `rituals/refinement.md` |
| pr-triage | any time; standup runs it | `rituals/pr-triage.md` |
| sprint-close | the sprint's last day, or after it ends | `rituals/sprint-close.md` |
| release | before a promotion or tag | `rituals/release.md` |

## Every ritual

1. `node ${CLAUDE_SKILL_DIR}/scripts/scrum.mjs report --out <scratch>/report.json`. Outside Claude Code, `${CLAUDE_SKILL_DIR}` is this skill's folder. No board in the profile: say so and stop.
2. Follow the ritual's file.
3. Write `<scratch>/notes.md` with `## Changed` (every write, with its ref), `## Needs a person` (by owner), `## Questions for you`, then the ritual's own sections.
4. `node ${CLAUDE_SKILL_DIR}/scripts/status-page.mjs --report <scratch>/report.json --notes <scratch>/notes.md --out <scratch>/sprint-status.html`. In Claude Code, publish it as an Artifact, to the profile's `Status page:` URL when there is one. On the first publish, give the user the URL to add to the profile's Tracking section. Other agents give the file path.
5. Reply in eight lines or fewer: what changed, who needs to act, questions, the page link.

With `--dry`, write "Would change" instead of "Changed" and make no write.

## Authority

Without asking:
- Status, Sprint, Priority, Size and Release on the board, through `board.mjs set` and `board.mjs sync`;
- assigning an issue or PR to the profile's owner for its repo (`gh api -X POST repos/<repo>/issues/<n>/assignees -f "assignees[]=<login>"`; `gh pr edit` fails on some repos);
- running reviewing-prs on a PR with no review round on its head commit;
- commenting on and closing PRs as pr-triage says, each close with a comment that gives the reason;
- the stale check (`rituals/stale-check.md`) on every issue that enters a sprint: its "Refreshed" comment, and trimming the acceptance list to what is still open.

Never approve, merge, deploy, tag or publish a release. Anything else goes under Questions for you. Mark every comment you post with `<!-- cleverways:scrum -->`, except a `@dependabot` command, which must stay alone in its comment.

## Ranking

`scrum.mjs rank` orders open issues: nearest Release, then open PR, security or High, blocking others, Medium, Low, oldest. Plan and refine in that order.

# running-scrum: design

Date: 2026-09-30. Status: approved in chat, awaiting spec review.

## Goal

One skill that runs a project's GitHub Project board the way a scrum master would, through named rituals a person triggers. It works for any project whose `.agents/project-profile.md` names a board, and for every agent the other cleverways skills support.

Success means:

- the board shows what is true now;
- nothing sits stuck without a named owner;
- an old issue is re-checked against current code before anyone works on it;
- a release always has drafted notes and a go/no-go list.

## Authority

The skill may, without asking:

- set board fields: Status, Sprint, Priority, Size, Release;
- roll unfinished cards over at sprint end;
- assign issues and PRs, using the profile's owner per repo;
- run reviewing-prs on a PR whose head changed since its last round;
- close superseded Dependabot PRs and PRs abandoned past the threshold, each with a comment saying why;
- flag merge conflicts and failing checks;
- refresh stale issues (below).

It never approves, merges, deploys, tags or publishes a release. Anything outside this list becomes an open question on the status page, and is never done quietly.

## Packaging

```
skills/running-scrum/
  SKILL.md            router, shared rules, authority (under 500 words)
  rituals/
    standup.md
    planning.md
    refinement.md
    pr-triage.md
    sprint-close.md
    release.md
  scripts/
    scrum.mjs         report | rank | stale
    status-page.mjs   report JSON + notes → one HTML page
    test/             node:test suites and fixtures
```

Invocation: `/cleverways:running-scrum <ritual>`, with `--dry` on every ritual. `--dry` lists the planned changes and makes none.

## Rituals

Every ritual starts with `scrum.mjs report` and ends by updating the status page. Every write it makes is listed in its reply and on the page.

| Ritual | When | Does |
|---|---|---|
| standup | daily, or any time | `board.mjs sync`. Flags PRs with conflicts, failing checks, or no review round on their head commit; cards in one status past the stuck threshold; In progress with no assignee; sprint issues not started. Runs reviewing-prs on PRs whose head changed. Assigns unowned cards by Owners. Includes pr-triage. |
| planning | sprint start | Ranks the backlog (`scrum.mjs rank`). Proposes the sprint list, sized against the last sprint's completed count. Runs the stale check on every issue pulled in. Sets Sprint, Status Ready and assignee. |
| refinement | mid-sprint | Lists backlog issues missing Priority, Size or Release, likely duplicates, and issues with no acceptance list. Runs the stale check on the top of the next sprint's ranked list. |
| pr-triage | any time | Conflicts; superseded Dependabot PRs (a newer Dependabot PR or a merged change covers the same packages); PRs with no activity past the abandoned threshold. Closes the last two with a reason. Gives each PR its issue's sprint, else the current one. |
| sprint-close | last day of a sprint | Moves every card not Done, including On test, to the next sprint (rollover; run after the sprint ended, that is the current one). Records planned, done and carried counts. Writes a short retro: what slipped and who it was blocked on. |
| release | before a promotion | Checks the Release field against what has merged into the base. Runs writing-release-notes for drafts. Writes a go/no-go list: open High items in the release, On test cards not verified, pending migrations or environment changes named in merged PRs. A person tags and deploys. |

## Ranking rule

`scrum.mjs rank` sorts open issues not Done, and prints each with the reason for its position:

1. nearest Release first (release order as the profile lists it); issues with no Release come last;
2. within a release, issues with an open PR (finish before start);
3. then `security` label or priority High;
4. then issues that block other open issues (sub-issue parents, and "blocked by" links);
5. then priority Medium, then Low, then unset;
6. ties: oldest created first.

The same input always gives the same order.

## Stale check

`scrum.mjs stale <ref>` reads the issue body and comments for `path:line` citations and commit SHAs or links (the evidence investigating-issues writes). Evidence SHA = the newest SHA cited; with none, the time of the newest comment that has citations.

For each repo the profile lists, it runs `git log <evidence>..origin/<base> -- <cited files>` and prints one of:

- `changed`: cited files changed since the evidence (lists the commits and PRs);
- `unchanged`;
- `no-evidence`: no citations, or the newest evidence is older than the stale threshold.

On `changed` or `no-evidence`, the agent re-checks each cited claim against the current base, following the investigating-issues skill's evidence rule, and posts one comment:

```
Refreshed at <sha> (base <branch>)
- <claim>: STILL TRUE | FIXED by #<pr> | CHANGED: <what>
Verdict: still valid | partly fixed (remaining: …) | no longer reproduces
```

It updates the acceptance list when the scope shrank. When the verdict is "no longer reproduces", the card goes to Backlog instead of the sprint, with a question on the status page.

## Report JSON

`scrum.mjs report [--board URL] [--profile path]` prints:

```
{
  "generatedAt": ISO time,
  "board": { "url", "currentSprint": { "title", "start", "end" } },
  "items": [{
    "ref", "type": "issue" | "pr", "title", "status", "statusSince",
    "sprint", "release", "priority", "size", "assignees", "labels",
    "linkedPrs" | "fixes", "createdAt", "updatedAt",
    "pr": { "mergeable", "checks": "pass" | "fail" | "pending" | "none",
            "headSha", "reviewedSha", "verdict", "author", "isDependabot" },
    "flags": ["stuck", "unassigned", "conflict", "checks-failing",
              "review-behind-head", "abandoned", "not-started"],
    "unknown": [field names the API failed to return]
  }],
  "sprint": { "planned", "done", "carried" }
}
```

`statusSince` comes from the item's field-change history where the API returns it, else `updatedAt`. `reviewedSha` and `verdict` come from the reviewing-prs tracker comment (`review-state.mjs get`). An item whose lookup fails keeps its known fields, and lists the rest in `unknown`. It is never dropped.

## Status page

`status-page.mjs --report report.json --notes notes.md --out page.html` writes one self-contained HTML page: no external scripts, light and dark themes, readable at phone width. Sections: sprint progress (planned, done, carried), blockers with owners, PRs ready to merge, stale or needs-refresh issues, open questions for the user, the last ritual run with its time and the writes it made.

- In Claude Code: publish as an Artifact. The first run records `Status page: <url>` in the profile's Tracking section, and later runs update that URL.
- Other agents: write the file and give its path.

## Profile additions

In the Tracking section, read by `scrum.mjs` and documented in `skills/project-profile/template.md`:

- `Owners: <repo> → <GitHub login>, …`: default assignee per repo.
- `Status page: <url>`.
- `Thresholds: stuck 3d, stale 30d, abandoned 30d`: optional, with these defaults.

## Changes to existing skills

- setting-up-project-tracking/SKILL.md: a PR takes its issue's sprint, else the current one (was: no sprint). Add running-scrum rows to the "Keeping it live" table. The sprint rollover rule moves here as sprint-close's job.
- setting-up-project-tracking/scripts/board.mjs:
  - `show` finds PRs (it reports "Not on the board" for PRs that are on it);
  - `set` keeps Status when the item is already on the board (it reset Status to Backlog);
  - `sync` gives PRs a sprint by the new rule.
- README.md: the skill in the table, a "run" row in "How they fit", and a Scrum master row in "Who uses what".
- project-profile/template.md: the three Tracking keys above.

## Failure handling

- No board in the profile: say so and stop. Creating a board stays with setting-up-project-tracking.
- `gh` lacks the `project` scope: ask the user to run `! gh auth refresh -h github.com -s project`, as setting-up-project-tracking does.
- An item's lookup fails: the report marks it `unknown`, and the page shows it.
- A write fails: the ritual reports it, and continues with the other items.

## Testing

- `node --test skills/running-scrum/scripts/test`: rank order on a fixture board covering each rule step; the stale check on a temporary git repo (changed, unchanged, no evidence); stuck and abandoned thresholds; the page rendered from an empty report and from a full one.
- board.mjs regression tests: `show` finds a PR; `set` on an existing item keeps its Status.
- A live `--dry` run of standup and planning on the PayDay board, with the output in the PR description.
- `claude plugin validate .` before pushing.

## Out of scope

- Scheduling runs. A person triggers rituals; the /schedule or /loop features can call them later.
- Creating or restructuring the board, views or fields.
- Merging, tagging, deploying, publishing releases.

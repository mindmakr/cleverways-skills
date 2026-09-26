---
name: reviewing-prs
description: Use when asked to review, critique or re-review a pull request, check whether a PR is ready to merge, or follow up on review findings after new commits.
---

# Reviewing PRs

The goal is a merge verdict backed by evidence: the PR fully covers its linked issues, breaks no project rule, and leaves no open question. Every finding, question and status lives in one tracking comment on the PR, so any agent in any session can resume the review.

**Required:** the project-profile skill and the writing-plainly skill. The state script is `node ${CLAUDE_SKILL_DIR}/scripts/review-state.mjs`; outside Claude Code, `${CLAUDE_SKILL_DIR}` is this skill's folder.

## One round

1. **Load.** Run `review-state.mjs get <pr>` and `review-state.mjs issues <pr>`. Also run `gh pr view <pr> --json state,mergeCommit,headRefOid,body,files,baseRefName`.
   - **Merged:** set the verdict to `MERGED`, close the linked issues by the profile's rule (a comment naming the PR and merge commit), update the tracker, and stop.
   - **Closed without merging:** set the verdict to `CLOSED`, update the tracker, and stop.
   - **Replies:** read the replies to your inline comments (`gh api repos/<repo>/pulls/<pr>/comments`). "Fixed in <sha>" is checked in step 4. A disagreement becomes a question for the user in step 5.
   - If `headRefOid` equals the state's `reviewedSha`, nothing new has been pushed. Report the current state and stop. Re-reviewing the same commit is the loop to avoid.
2. **Scope.** The linked issues are those `issues` printed; their acceptance checklists are the coverage goal. Take linked PRs in other repos from the issues.
   - When the PR links no issue, the PR description is the goal: turn its claims into checklist items. In the first round, ask once whether that is the full scope.
   - The range is `reviewedSha..head` when `reviewedSha` is an ancestor of head (`git merge-base --is-ancestor`), otherwise the whole PR.
3. **Review, in parallel where the agent can:**
   - **Correctness.** In Claude Code, run the `code-review` skill on the PR at level `high`. Elsewhere, read the diff for defects.
   - **Project reviewer.** Give a subagent `reviewer-brief.md` from this skill's folder, plus the PR, the range, the issues and the open findings. It returns coverage, earlier-finding status, candidate findings and questions, as JSON.
4. **Verify.** Keep a candidate only when you can open its file and see the quoted line at head, and the reason holds. A candidate that depends on intent becomes a question. Drop duplicates by fingerprint: `path:symbol:problem`.
5. **Ask.** Ask the user the round's open questions together, at most four, each with options and your recommendation (AskUserQuestion in Claude Code). Record each answer in the state. A question once answered is never asked again. If the user is not available, mark the question open and set `blockedOn` to the user.
6. **Update the state.**
   - New findings get the next `R<n>` id, `status: open` and this round's number.
   - Earlier findings move to `fixed` only with evidence.
   - `wontfix` needs the user's decision recorded as a question.
   - An answer that asks for a change becomes a finding and cites the question ("decided (Q2)").
   - Set `round + 1` and `reviewedSha = head`.
7. **Post.**
   - Run `review-state.mjs put <pr> --file <state.json>` to update the tracking comment.
   - Post one review with `gh api repos/<repo>/pulls/<pr>/reviews --input review.json`, with `commit_id` set to head and `event: COMMENT`. It puts an inline comment in `comments[]` (path, line, `side: RIGHT`) for each new finding on a line the diff changes, and every other finding in the review body. GitHub rejects inline comments outside the diff. Each finding gives its ID, severity, problem, fix and pinned citation.
   - Post a review every round, even when there is no new finding. It is the newest item on the PR, so readers see the current verdict. Its body starts with `<!-- cleverways:review-round:<n> -->`, then the verdict line and a link to the tracker.
   - Run `review-state.mjs resolve <pr>`. It resolves the inline thread of each finding now `fixed`, hides earlier round reviews as outdated, and once nothing is open, hides earlier round reviews and fix notes as resolved. The latest round review and the tracker stay visible. The conversation then shows only what is still open, plus the tracker.
   - Never approve, request changes or merge.
8. **Verdict**, which is also the tracking comment's heading:
   - **READY TO MERGE:** every acceptance item is covered with evidence, no open finding is medium or higher, there are no open questions, `gh pr checks` is green, and linked PRs are aligned.
   - **NEEDS FIXES:** any open finding or missing coverage.
   - **BLOCKED ON <who>:** the next step belongs to someone else.

## Loop control

- A round runs only on a new head commit (step 1), so waiting for the author is a stop, not a loop.
- Within a session, a new round starts only when this session pushed fixes (the resolving-issues skill) or the user asks again. Run at most three rounds per session.
- Stop when a round changes nothing: no new findings and no status changes. Report "stalled" with each open item and its owner.
- Every open item has one owner: author, user or reviewer. Act on reviewer items. Hand the others over and stop. Never poll, sleep or wait for a reply.

## Output

Reply to the user in eight lines or fewer:
1. The verdict.
2. Round and head commit.
3. Counts: new, fixed and open findings.
4. The tracking comment link.
5. Questions still open, and who is blocking.
6. What was not reviewed.

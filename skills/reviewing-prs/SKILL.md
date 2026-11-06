---
name: reviewing-prs
description: Use when asked to review, critique or re-review a pull request, check whether a PR is ready to merge, or follow up on review findings after new commits.
---

# Reviewing PRs

The goal is a merge verdict backed by evidence: the PR fully covers its linked issues, breaks no project rule, and leaves no open question. Every finding, question and status lives in one tracking comment on the PR, so any agent in any session can resume the review.

**Required:** the project-profile skill and the writing-plainly skill. The state script is `node ${CLAUDE_SKILL_DIR}/scripts/review-state.mjs`; outside Claude Code, `${CLAUDE_SKILL_DIR}` is this skill's folder.

## One round

1. **Load.** Run `review-state.mjs get <pr>` and `review-state.mjs issues <pr>`. Also run `gh pr view <pr> --json state,mergeCommit,headRefOid,body,files,baseRefName`.
   - **Merged:** set the verdict to `MERGED`, close the linked issues by the profile's rule (naming the PR and merge commit), run `board.mjs set <issue refs> --status "On test"` and `board.mjs set <pr url> --status Done` (the setting-up-project-tracking skill's script), update the tracker, and stop.
   - **Closed without merging:** set the verdict to `CLOSED`, move the PR to Done and its issues to Ready, update the tracker, and stop.
   - **Replies:** read the replies to your inline comments (`gh api repos/<repo>/pulls/<pr>/comments`). "Fixed in <sha>" is checked in step 4. A disagreement becomes a question for the user in step 5.
   - **Other reviewers:** read every review and inline comment by others and every failing check. Each claim is a candidate for step 4, verified like your own and credited to its author.
2. **Scope.** Run `review-state.mjs scope <pr>`. It prints the round's `range` (the whole PR in round 1 or after a rebase, else `reviewedSha..head`), `security`, `correctness`, a worktree `dir` at head with its `prepare` and `cleanup` commands, and the range's `diff`. `same: true` means nothing new was pushed: report the current state and stop. Exit 5 is the round cap (Loop control).
   - The acceptance checklists of the issues `issues` printed are the coverage goal. Linked PRs in other repos come from the issues. When the PR links no issue, the PR description is the goal: turn its claims into checklist items. In round 1, ask once whether that is the full scope.
3. **Review the range, in parallel where the agent can.** Run `prepare` first. A skill or subagent cannot `cd`, so reviewers read `dir` by path.
   - **Reviewer, every round without exception.** One subagent gets `reviewer-brief.md` from this skill's folder, the PR, `dir`, `diff`, the issues and the open findings. It looks for defects as well as coverage and project rules, and returns JSON.
   - **The `code-review` skill**, only when `correctness` names it: a whole-PR pass while the session's checkout is at head. Run it as written, at high.
   - **Security, only when `security` is true:** round 1, or the range touches a security-relevant path (`securityFiles`). Run `node ${CLAUDE_SKILL_DIR}/scripts/security-scan.mjs --pr <pr>` from the repo. Its header lists the scans. Exit 3 or 4 goes under "not reviewed". With the checkout at head, also run the `security-review` skill; otherwise ask the reviewer to check the range for injection, missing authorisation or tenant scoping, and unsafe input. A confirmed security finding is at least high.
   - Run `cleanup` after step 4.
4. **Verify.** Keep a candidate only when you can open its file and see the quoted line at head, and the reason holds. A candidate that depends on intent becomes a question. Drop duplicates by fingerprint: `path:symbol:problem`.
5. **Ask.** Ask the user the round's open questions together, at most four, each with options and your recommendation. Record each answer in the state; never ask it again. If the user is not available, mark the question open and set `blockedOn` to the user.
6. **Update the state.**
   - New findings get the next `R<n>` id, `status: open` and this round's number.
   - Earlier findings move to `fixed` only with evidence.
   - `wontfix` needs the user's decision recorded as a question. A finding the user defers ("later", "out of scope") is filed as a follow-up issue by the investigating-issues skill's Follow-ups rule, and the tracker row links it.
   - An answer that asks for a change becomes a finding and cites the question ("decided (Q2)").
   - Set `round + 1` and `reviewedSha = head`.
7. **Post.**
   - Run `review-state.mjs put <pr> --file <state.json>` to update the tracking comment.
   - Post one review with `gh api repos/<repo>/pulls/<pr>/reviews --input review.json`, with `commit_id` set to head and `event: COMMENT`. Each new finding on a line the diff changes gets an inline comment in `comments[]` (path, line, `side: RIGHT`); GitHub rejects others, so they go in the review body. Each finding gives its ID, severity, problem, fix and pinned citation.
   - Post a review every round, even with no new finding. Its body starts with `<!-- cleverways:review-round:<n> -->`, then the verdict line and a link to the tracker.
   - Run `review-state.mjs resolve <pr>`, so the conversation shows only what is still open, plus the tracker.
   - Never approve, request changes or merge.
8. **Verdict**, which is also the tracking comment's heading:
   - **Final pass.** A range round that would end READY first runs `scope <pr> --final` and step 3 on what it prints (the whole PR), verified as in step 4.
   - **READY TO MERGE:** every acceptance item is covered with evidence, no open finding is medium or higher, there are no open questions, the checks pass on head, and linked PRs are aligned. A low finding outside the round's range never blocks. The profile's Commands line `Checks:` says where checks run. With `ci` or no line, `gh pr checks` is green. With `local`, run `node ${CLAUDE_SKILL_DIR}/../project-profile/scripts/checks.mjs` on head; every line must read PASS. Record the run in the state's `checks` (where, command, sha, result line). Move the PR and its issues to Ready to merge with `board.mjs`.
   - **NEEDS FIXES:** an open finding of medium or higher, a new low finding in the range, or missing coverage. If the PR was Ready to merge on the board, move it and its issues back to In review.
   - **BLOCKED ON <who>:** the next step belongs to someone else.

## Loop control

- A round runs only on a new head commit (step 2), so waiting for the author is a stop, not a loop.
- A PR gets four rounds. `scope` and `put` refuse a fifth (exit 5) and print the open items; deleting the tracker does not reset the count. Set the verdict to BLOCKED ON user, put the tracker with an open question asking whether to allow more rounds, and ask the person to answer on the PR (e.g. "Q3: allow 2 more"). Only that reply grants rounds: record its comment id as `answerComment` with `extraRounds: <n>`.
- Within a session, a new round starts only when this session pushed fixes (the fixing-issues skill) or the user asks again.
- Stop when a round changes nothing: no new findings and no status changes. Report "stalled" with each open item and its owner.
- Every open item has one owner: author, user or reviewer. Act on reviewer items; hand the others over and stop. Never poll, sleep or wait for a reply.

## Output

Reply in six lines:
1. The verdict.
2. Round and head commit.
3. Counts: new, fixed and open findings.
4. The tracking comment link.
5. Questions still open, and who is blocking.
6. What was not reviewed.

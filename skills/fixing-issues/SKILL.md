---
name: fixing-issues
description: Use when asked to fix, resolve or implement a GitHub issue or planned task, especially one linked to issues in other repositories, or to address review findings left on a pull request.
---

# Fixing issues

Linked issues are one change. Fix all of them in the same session, in the order the issue states.

**Required:** the project-profile skill (commands, git flow, locales) and the writing-plainly skill. If the issue has no investigation with cited evidence (permalink, symbol, quoted code), run the investigating-issues skill first.

## Steps

1. **Read.** The input is an issue, a planned task, or a PR with review findings.
   - **PR with a review tracker:** run `review-state.mjs get <pr>` (the reviewing-prs skill's script). The findings with `status: open` are the work list, and answered questions are requirements. Work on the PR's own branch; no new PR.
   - **Planned task:** check that every task in its "Depends on" is closed. If one is not, stop and name the blocking task.
   - **Issue:** read the issue, its comments and every linked issue.

   For every input: list the repos and the order they are fixed in. The default order is the layer that owns the logic first, then its clients. Re-find each cited location by its symbol and quoted code, not by the line number, because the line may have moved. If the quoted code is gone, check `git log -S '<quoted code>'` to see whether someone already fixed it, and say so on the issue.

   Then claim the work: `gh issue edit <n> --add-assignee @me` and `board.mjs set <refs> --status "In progress" --sprint current` for every issue in the change (the setting-up-project-tracking skill's script). A parent still in Backlog or Ready moves to In progress too.
2. **Branch.** In each repo, run `git branch --show-current` before the first write. Run it again in the same command as every commit and push. Create the branch the profile's git flow names.
   - If the branch is checked out in another worktree (someone else's session), leave that worktree alone. Add your own with `git worktree add --detach <dir> origin/<branch>`, and push with `git push origin HEAD:<branch>` after checking that the remote head has not moved.
   - Edit code with the file editor, not with shell one-liners: the shell expands backticks and `$` inside strings, and can run what it expands.
3. **Red.** Write a test that reproduces the issue's figures. Run it and watch it fail.
4. **Fix at the cause.** Reuse the shared helper, or create one. Add no fallback values, compatibility shims or second copies of a rule.
5. **Verify.** Run the profile's commands for every area you touched (typecheck, lint, tests, guardrails, translation check). Paste the real output. A failing command means the work is not done.
6. **Check the UI.** For a visible change, run the testing-web-visually or testing-mobile-visually skill with `--only` set to the changed screens, covering each text direction and a phone-width screen.
7. **PR.** Open one PR per repo, on the profile's base branch and stacking rule. The body starts with `Fixes <owner/repo>#<n>` for each issue it resolves (`Refs` for one it only advances), lists the linked PRs with their merge order, says what changed, and includes the test output. The board script links PR to issue by those words, since GitHub does not for PRs outside the default branch. Then `board.mjs set <refs> --status "In review"`, and request the profile's reviewers except the PR's author, whom GitHub refuses (`gh pr edit <pr> --add-reviewer <handle>`), so a person picks it up.
   - **Addressing review:** push to the same PR instead. Reply to each fixed finding's inline comment with `Fixed in <sha>: <one line>`, or give the reason it is not being fixed. Findings without an inline comment get one PR comment that starts with `<!-- cleverways:fix-note -->` and lists `R<n>: Fixed in <sha>: <one line>`. Leave threads unresolved; the reviewer resolves them once the fix is verified.
8. **Report.** Comment on each issue with the PR link, what changed, the test results and anything left open. Anything left open that is outside this issue's scope becomes an issue now, with the investigating-issues skill's Follow-ups rule, and the comment links it.
9. **Hand to review.** Run the reviewing-prs skill on each PR. The new commit starts its next round. Merge only when the user asks. Issues close after merge (reviewing-prs and verifying-fixes do that).

## Output

Keep each PR body and issue comment to these parts:
- **Changed:** up to five bullets, one line each, with `path`.
- **Tests:** the command and its pass/fail line, verbatim.
- **Linked:** the other PRs and their merge order.
- **Open:** anything left undone, or "none".

Keep the reply to the user to six lines or fewer: PR links, one line on what changed, test status, and open items or questions. Leave out preamble, recaps and offers.

## Stop and verify

| Thought | Do instead |
|---|---|
| "The mobile side can follow later" | Linked issues are fixed in this session. |
| "Tests pass, so it works" | Check the UI change as well (step 6). |
| "A small fallback keeps it safe" | Fix whatever produces the bad value. |
| "I'll push straight to the base branch" | Never. Open a PR. |
| "It must still be on my branch" | Check the branch in the same command as the commit. |
| "I'll mention the leftover in the PR" | File it as a follow-up issue with a priority, and link it. |

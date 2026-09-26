---
name: resolving-issues
description: Use when asked to fix, resolve or implement a GitHub issue, especially one linked to issues in other repositories.
---

# Resolving issues

Linked issues are one change. Fix all of them in the same session, in the order the issue states.

**Required:** the project-profile skill (commands, git flow, locales) and the writing-plainly skill. If the issue has no investigation with `path:line` evidence, run the investigating-issues skill first.

## Steps

1. **Read.** Read the issue, its comments and every linked issue. List the repos and the order they are fixed in. The default order is the layer that owns the logic first, then its clients. Re-find each cited location by its symbol and quoted code, not by the line number, because the line may have moved. If the quoted code is gone, check `git log -S '<quoted code>'` to see whether someone already fixed it, and say so on the issue.
2. **Branch.** In each repo, run `git branch --show-current` before the first write. Run it again in the same command as every commit and push. Create the branch the profile's git flow names.
3. **Red.** Write a test that reproduces the issue's figures. Run it and watch it fail.
4. **Fix at the cause.** Reuse the shared helper, or create one. Add no fallback values, compatibility shims or second copies of a rule.
5. **Verify.** Run the profile's commands for every area you touched (typecheck, lint, tests, guardrails, translation check). Paste the real output. A failing command means the work is not done.
6. **Check the UI.** For a visible change, check each text direction the locales use and a phone-width screen.
7. **PR.** Open one PR per repo, on the profile's base branch and stacking rule. The body links the issue, lists the linked PRs with their merge order, says what changed, and includes the test output.
8. **Report.** Comment on each issue with the PR link, what changed, the test results and anything left open. Merge only when the user asks. Close issues by the profile's rule.

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

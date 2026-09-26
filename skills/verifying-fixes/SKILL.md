---
name: verifying-fixes
description: Use when asked to test, QA or verify that an issue is fixed, check a merged PR against its acceptance list, or confirm release items before closing or reopening issues.
---

# Verifying fixes

An issue is done when every acceptance item has passed, each with evidence, on the merged code. Verification ends with the issue closed or reopened.

**Required:** the project-profile skill (git flow, local run, close rule) and the writing-plainly skill.

## Steps

1. **Read.** Read the issue's acceptance checklist and the PR that fixed it (`gh pr view <pr> --json state,mergeCommit,baseRefName`).
   - Not merged: verify on the PR branch, locally, and report. Close nothing.
   - Merged: verify at the merge commit on the base branch.
2. **Plan the checks.** Choose one check for each acceptance item:
   - **Test:** a test that asserts the item. Run it and paste the pass line.
   - **Visual:** the testing-web-visually or testing-mobile-visually skill, with `--only` set to the affected screens, in every locale and size the item names.
   - **Manual:** steps a person follows on the local stack. The agent runs them when it can drive the UI; otherwise the user runs them and reports the result.
3. **Run.** Use only the local stack and seeded data. For an environment such as test or demo, write the manual steps for a tester instead. Never use real credentials, and never point automation at a remote environment.
4. **Record.** Comment on the issue:

   | Item | Check | Result | Evidence |
   |---|---|---|---|
   | <acceptance text> | test / visual / manual | pass / fail | <test line, screenshot link, or the user's confirmation> |

5. **Conclude.**
   - **All pass:** tick the checklist, close the issue by the profile's rule if it is still open, naming the PR and merge commit, and run `board.mjs set <ref> --status Done` (the setting-up-project-tracking skill's script). When it was its parent's last open sub-issue, verify the parent's "Done when" the same way, then tick, close and move the parent to Done.
   - **Any fail:** keep the issue open, or reopen it, and move it to Ready on the board. Name the failing item and its evidence, and link the PR. A new defect that the fix did not cause becomes a follow-up issue, by the investigating-issues skill's Follow-ups rule.
6. **Reply** in five lines or fewer: the verdict per issue, links, and anything that is waiting on a person.

## Stop

| Thought | Do instead |
|---|---|
| "The PR says it is fixed" | Run the check. A PR description is not evidence. |
| "Close it; the rest is minor" | Close only when every item passes. |
| "Faster to test on the test server" | Automation runs locally. Remote environments get written steps. |

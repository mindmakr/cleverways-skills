---
name: reporting-visual-defects
description: Use when findings from a visual, UI, layout, translation or screenshot test need to become GitHub issues, or when a visual test run needs its evidence attached to existing issues.
---

# Reporting visual defects

One root cause is one issue, carrying pinned screenshots from the local run. Screenshots only ever show local seeded data.

**Required:** the project-profile skill (title prefix, labels, linked-issue order) and the writing-plainly skill.

## Steps

1. **Group.** A string broken on three screens is one issue that lists all three. One screen broken in two locales for two different reasons is two issues.
2. **Fingerprint** each defect as `<repo>:<route or screen>:<check>:<key or element>`, in lowercase. Look for an existing issue with `gh issue list --label visual-test --state all --search "vt:<fingerprint> in:body"`.
   - An open match gets a comment with this run's evidence.
   - A closed match that still reproduces gets reopened with that comment.
   - No match gets a new issue.
3. **Screenshots.** Publish them to the orphan branch, which is never merged or deployed:
   ```
   node ${CLAUDE_SKILL_DIR}/scripts/publish-screenshots.mjs --repo <repo dir> --run <run id> <png> [...]
   ```
   The script prints one URL per file, pinned to the commit. Publish only the screenshots the issues use.
4. **File.** Use `issue-template.md` from this skill's folder, and keep the `<!-- vt:… -->` line. Labels are `visual-test`, `bug` and a priority: take the priority from the user, otherwise from the severity table below. Create a missing label with `gh label create visual-test --color 5319E7`. The title prefix comes from the profile.
5. **Cross-repo.** When the cause lives in another repo (for example a server-side string), file the issue there as well, and open both with the linked-issues note from the investigating-issues skill.
6. **Reply** in six lines or fewer: the new issue links, the updated ones, and any finding you did not file, with the reason.

## Severity

| Priority | When |
|---|---|
| high | Blocks a task, shows wrong money, or shows another user's data |
| medium | Wrong or untranslated text, a broken layout on phones or in right-to-left locales, errors in the console or API |
| low | Cosmetic: spacing, alignment, colour |

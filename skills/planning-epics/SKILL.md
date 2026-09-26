---
name: planning-epics
description: Use when asked to plan an epic, a milestone, a release theme or any initiative that needs several features across weeks or repos.
---

# Planning epics

An epic is a milestone plus one `epic` issue. It holds several features, and each feature holds its tasks.

**Required:** the planning-work skill runs every step. This skill adds only what is specific to epics.

## Structure

- **Milestone:** named after the outcome, not the team ("Employers can settle early"). Set a due date only when the user gives one. The planning script creates it in every repo the epic touches, under the same title.
- **Epic issue:** labels `epic`. Its "Plan" table lists the features, not the tasks.
- **Feature issues:** labels `feature`, each a sub-issue of the epic. Plan each one with the planning-features skill's rules.
- **Task issues:** labels `task`, each a sub-issue of its feature, never of the epic directly.

## Epic-specific checks

1. **Slices.** Each feature is a slice a user can see or use on its own. "Backend for X" is not a feature; it is a task inside the feature that needs it.
2. **Order.** List the features in delivery order, and mark which ones can run in parallel.
3. **Size.** An epic with more than about eight features, or six weeks of work, is two epics. Propose the split in the draft.
4. **Done when.** The epic's checklist names the outcome, measured the way the user will measure it, not "all features closed".

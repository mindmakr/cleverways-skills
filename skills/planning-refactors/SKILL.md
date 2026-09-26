---
name: planning-refactors
description: Use when asked to plan a refactor, a cleanup, a restructuring, removal of duplication, or improvement of code quality or performance without changing what users see.
---

# Planning refactors

A refactor improves the code and leaves behaviour unchanged. Its plan proves both halves: the improvement, and the unchanged behaviour.

**Required:** the planning-work skill runs every step. This skill adds only what is specific to refactors.

## Structure

- One `refactor` issue with its `task` sub-issues. When the work touches more than one feature area or runs past about six tasks, plan it at epic level (a milestone plus a `refactor` parent), laid out as the planning-epics skill describes.

## Refactor-specific checks

1. **Measurable improvement.** State what gets better, with a number where one exists: duplicated rules merged into one helper, files or lines removed, query count, response time, bundle size. Measure the "before" now, with a citation or command output.
2. **Behaviour lock first.** The first task adds or confirms the tests that pin current behaviour in the code being changed. No task changes structure before those tests exist and pass.
3. **Small steps.** Each task leaves the build and tests green and can ship alone. Never "rewrite X" as one task.
4. **No behaviour change.** A task that would change what a user sees belongs in a feature or a replacement, not here. Move it out, and say where it went.
5. **Done when.** The improvement measured again, against the "before" number, and the behaviour-lock tests still passing.

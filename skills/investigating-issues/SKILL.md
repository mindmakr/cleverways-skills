---
name: investigating-issues
description: Use when asked to investigate a bug, a screenshot, a tester report or a GitHub issue, before proposing a fix or filing an issue.
---

# Investigating issues

Every finding comes from code, data or a command you ran, cited as `path:line` or as the output. What you did not verify goes under "Not checked". It never appears as a finding.

**Required:** the project-profile skill (repos, layers, labels, linked-issue order) and the writing-plainly skill for everything you write.

This skill changes no code.

## Steps

1. **Dedupe.** Run `gh issue list --search "<key terms>" --state all` in every repo the profile lists. If the issue exists, post your new findings there as a comment and stop at step 7.
2. **Pin the evidence.** Write a table of what was observed and what was expected, with the report's own numbers. If the expected value depends on a rule you cannot find in code, ask the user: one question, options, your recommendation first.
3. **Trace.** Follow the value from the screen through the API, the service and the query to the line that produces it. Show the arithmetic that reproduces the reported number from the stored data.
4. **Sweep.** Search for the same pattern (the same field, query shape or helper) in every layer and every repo the profile lists. Record each hit as ✅ correct, ❌ affected or n/a, with `path:line`. Cover labels, layout and display, and any client that computes what the profile says the server owns.
5. **Plan the fix.** Fix it in the layer that owns the logic, with one shared helper when several sites need the same rule. For each file, say what changes. A contract change that a separately released client reads must be additive. Add translations for every locale in the profile, tests that use the figures from step 2, and an acceptance checklist.
6. **Log it.** Open one issue per affected repo using `issue-template.md` from this skill's folder, with the title prefix and labels from the profile. When more than one repo is affected, each issue opens with the template's linked-issues note and links the others.
7. **Reply.** Give the issue links, the root cause in one or two lines, the affected surfaces, any open decisions, and what you did not check.

## Stop and verify

| Thought | Do instead |
|---|---|
| "This probably comes from…" | Open the file and cite the line. |
| "The other repo is likely fine" | Search it and record ✅ with the path. |
| "The profile says X" | Confirm X in the code first. |
| "The expected value is obvious" | Find the rule in the code, or ask. |
| "Only this screen is affected" | Finish step 4 before step 5. |
| "Quicker to fix it now" | Investigation changes no code. Log it. |

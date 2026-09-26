---
name: planning-work
description: Use when turning a request into GitHub milestones and issues, and when another planning skill (epics, features, replacements, refactors) reaches its draft, approve and create steps.
user-invocable: false
---

# Planning work

A plan is only as good as the investigation behind it. Every task names the code it changes, cites it, and states the result that shows it is done. Planning creates issues and changes no code.

**Required:** the project-profile skill (repos, layers, labels, rules) and the writing-plainly skill. Cite code as the investigating-issues skill does.

## Steps

1. **Understand.** Restate the goal in one or two lines.
   - Ask the user, in one batch of at most four questions with options and a recommendation, about anything the code cannot answer: scope edges, deadlines, business rules.
   - Never ask about what the code can tell you.
2. **Investigate.**
   - Find the current state in every repo and layer the profile lists, with pinned citations.
   - Check for existing work: `gh issue list --search "<terms>" --state all` and open milestones. Reuse what exists rather than duplicating it.
3. **Decompose.**
   - Break the work into tasks of size L or smaller (sizes are in `issue-templates.md`).
   - Order them by dependency: the layer that owns the logic first, then its clients.
   - Give each task one repo. When a change spans repos, split it into one task per repo, linked, following the profile's linked-issue order.
4. **Draft.** Show the plan as one table: key, title, repo, type label, depends on, size. Show the milestone title and due date if there is one. Ask once: create it, adjust it, or stop.
5. **Create.**
   - Write `plan.json` in the shape the script documents, with bodies from `issue-templates.md`.
   - Run `node ${CLAUDE_SKILL_DIR}/scripts/plan-to-github.mjs --plan plan.json --dry`, check the output, then run it without `--dry`. Outside Claude Code, `${CLAUDE_SKILL_DIR}` is this skill's folder.
   - Every child issue carries the `task` label. The parent carries its type: `epic`, `feature`, `replace` or `refactor`.
   - Re-running is safe: existing titles are reused.
6. **Reply** in six lines or fewer: the milestone link, the parent link, the task count per repo, and the first task to start. Implementation then runs one task at a time with the fixing-issues skill, and each PR goes through the reviewing-prs skill.

## Stop

| Thought | Do instead |
|---|---|
| "The task list is obvious" | Investigate first. A task without a citation is a guess. |
| "Create now and adjust later" | Draft, one confirmation, then create. |
| "One big task is simpler" | Split anything over L. |
| "Mobile can have its task later" | Every repo that needs a change gets its task in this plan. |

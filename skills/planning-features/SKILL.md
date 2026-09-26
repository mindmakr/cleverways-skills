---
name: planning-features
description: Use when asked to plan a new feature or capability, on its own or as part of an epic or milestone, before any code is written.
---

# Planning features

A feature is one `feature` issue with its `task` sub-issues. It either stands alone or sits under an epic and inside its milestone.

**Required:** the planning-work skill runs every step. This skill adds only what is specific to features.

## Placement

- **Part of an epic:** use the epic's milestone. Set the feature's `parent` to the epic issue, which is the `{ "number": … }` form in `plan.json`.
- **Standalone:** no milestone unless the user names one.

## Feature-specific checks

1. **Behaviour first.** Before listing tasks, write what a user can do afterwards: roles, screens, and each state (empty, loading, error, success). This becomes the feature's "Done when".
2. **Every surface.** Plan a task for each layer and repo the profile lists that the feature reaches:
   - the server logic;
   - each client that shows it;
   - the public API and agent tools, if they expose the data;
   - translations in every locale.
3. **Contract.** When a client in another repo consumes a new or changed API, the server task defines the response shape, and the client task cites it. Changes that a separately released client reads are additive.
4. **Tests per task.** Each task names its test. The feature adds one end-to-end check of the behaviour from step 1, such as a visual-test flow or an integration test.

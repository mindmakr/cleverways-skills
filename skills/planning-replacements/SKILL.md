---
name: planning-replacements
description: Use when asked to replace one behaviour, implementation, library, provider or data shape with another, including migrations from an old way to a new way.
---

# Planning replacements

A replacement ends with the old way gone. Every caller has moved to the new way, and nothing still offers both.

**Required:** the planning-work skill runs every step. This skill adds only what is specific to replacements.

## Structure

- **Small:** a single `replace` issue whose `task` sub-issues fit in one milestone-free plan.
- **Large:** more than about six tasks, or more than one feature's worth. Plan it at epic level: a milestone plus a `replace` parent issue, laid out as the planning-epics skill describes, with `replace` in place of `epic`.

## Replacement-specific checks

1. **Inventory.** List every use of the old way in every repo and layer: callers, config, env vars, data, docs, tests. Give each one a citation. The inventory is the parent issue's "Current state", and every entry maps to a task.
2. **Behaviour to keep.** Name what must behave the same after the switch, and pin it with tests before the switch (the first task). Name what changes on purpose.
3. **Cutover.** Choose, and state:
   - a direct switch;
   - a switch in steps behind the new interface;
   - a data migration, with its script, the environments it runs on, and its rollback.

   Follow the profile's rules on data scripts and migrations.
4. **Removal.** The last task deletes the old way and proves it is gone (a search that returns nothing). A plan without a removal task is not a replacement.
5. **Clients.** Separately released clients keep working until they ship: the server accepts the old shape until the client task lands, and a later task removes it.

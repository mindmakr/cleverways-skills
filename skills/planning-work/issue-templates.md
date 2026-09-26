# Issue templates

Every body below is filled from the investigation. Cite code as the investigating-issues skill does: a pinned permalink, the symbol and the quoted line. Delete any section that has nothing in it.

## Parent (epic, feature, replace or refactor)

```
## Goal
<one or two lines: the outcome, in the user's or the business's terms>

## Scope
- In: <…>
- Out: <…>

## Current state
<what exists now, with pinned citations>

## Plan
| Key | Issue | Repo | Depends on | Size |
|---|---|---|---|---|
| T1 | {{T1}} | web | none | S |

## Done when
- [ ] <observable, testable result>
```

## Task

```
<!-- plan:<parent key>:<task key> -->
Part of {{P}}.

## Do
<the change, file by file, with pinned citations for what exists now>

## Depends on
<{{T1}}, or "none">

## Tests
<the test that fails before and passes after, with the figures it uses>

## Done when
- [ ] <observable result>
- [ ] Translations in every locale, and phone plus right-to-left checked (when there is UI)
```

## Sizes

S: under half a day. M: about a day. L: two to three days. Anything bigger is split into more tasks.

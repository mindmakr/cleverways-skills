---
name: writing-release-notes
description: Use when asked for release notes, a changelog, a "what shipped" summary, or notes for a promotion between environments, tags or branches.
---

# Writing release notes

One list of changes, two outputs:
- a GitHub release per repo, for the team, which is the source of truth;
- a stakeholder page in plain language.

Every line traces back to a PR or a commit.

**Required:** the project-profile skill (repos, tag format, audiences, terms) and the writing-plainly skill.

## Steps

1. **Range.** If the user did not give one, ask: since the last tag, since the last promotion, or a custom range. Resolve it to a from-ref and a to-ref in each repo.
2. **Collect.** For each repo, run `git log --first-parent --merges <from>..<to>` and `gh pr list --state merged --base <branch> --search "merged:<from-date>..<to-date>" --json number,title,labels,body,url`. When a PR's title does not say what changed for users, read its body and diff.
3. **Group.** Use these groups: Added, Fixed, Changed, Security, Config and migrations (env vars, migrations, manual steps), Breaking. A web PR and a mobile PR for the same change become one entry that links both.
4. **Team release.** Run `gh release create <tag> --draft --title "<tag>" --notes-file <file>` in each repo. Link the other repo's release. Leave it as a draft until the user says publish.
5. **Stakeholder page.** Include user-visible changes only, in the profile's terms. Leave out PR numbers, file names, branches and implementation status. Say plainly when something is not live yet. Publish it as a shareable page where the agent can (a Claude artifact); otherwise write `release-notes-<tag>.md`.
6. **Reply.** Give the draft links, the page link, and any PR you could not classify.

## Team release format

```
## <tag> · <date>
Pairs with <owner/repo> <tag>.

### Fixed
- <what changed, in one line> (#123, owner/repo#45)

### Config and migrations
- <env var / migration / manual step, and where it is documented>
```

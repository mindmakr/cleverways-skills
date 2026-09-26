---
name: writing-release-notes
description: Use when asked for release notes, a changelog, a "what shipped" summary, or notes for a promotion between environments, tags or branches.
---

# Writing release notes

One list of changes serves four readers:

| Reader | Needs | Where |
|---|---|---|
| Developers | Every change, with its PR and linked issues | GitHub release, "Changes" |
| Testers | What to test, where, how, and what should happen | GitHub release, "For testers" |
| DevOps | What to set, run and deploy, in what order, and how to roll back | GitHub release, "For devops" |
| Stakeholders | User-visible changes in product terms | Stakeholder page |

Every line traces back to a PR or a commit.

**Required:** the project-profile skill (repos, tag format, environments, audiences, terms) and the writing-plainly skill.

## Steps

1. **Range.** If the user did not give one, ask: since the last tag, since the last promotion, or a custom range. Resolve it to a from-ref and a to-ref in each repo.
2. **Collect.** Run `board.mjs sync --dry` and `board.mjs list --release <tag>` (the setting-up-project-tracking skill's script) to see what the board expects in this release. For each repo, run `git log --first-parent --merges <from>..<to>` and `gh pr list --state merged --base <branch> --search "merged:<from-date>..<to-date>" --json number,title,labels,body,url,files`. When a title does not say what changed, read the body and the diff.
   Then run `board.mjs set <issue refs> --release <tag>` for each shipped issue whose Release is empty or different. A missing Release option is added in the board UI, never by API. Anything the board has under this release that did not ship goes in the reply.
3. **Group the changes.** Use Added, Fixed, Changed, Security, Breaking. A web PR and a mobile PR for the same change become one entry that links both.
4. **For testers.** For each user-visible change, give:
   - the screen and role;
   - the locales and screen sizes it affects;
   - the steps;
   - the expected result, using the figures from the issue's acceptance list.

   List the regressions to re-check around the changed code.
5. **For devops.** Find these in the diffs:
   - new or changed env vars (in the profile's env docs and `.env.example`);
   - database migrations;
   - one-off scripts or backfills;
   - new queues, cron jobs or services;
   - dependency or runtime upgrades;
   - the deploy order across repos, such as backend before mobile.

   For each, say what to do and on which environments, and give the rollback. Write "None" when a section has nothing; never leave it out.
6. **Draft the GitHub release.** In each repo, run `gh release create <tag> --draft --title "<tag>" --notes-file <file>`, linking the other repo's release. Leave it as a draft until the user says publish.
7. **Stakeholder page.** Include user-visible changes only, in the profile's terms. Leave out PR numbers, file names and implementation status. Say plainly when something is not live yet. Publish it as a shareable page where the agent can (a Claude artifact); otherwise write `release-notes-<tag>.md`.
8. **Reply.** In four lines or fewer: the draft links, the page link, any PR you could not classify, and the board items planned for this release that did not ship.

## GitHub release format

```
## <tag> · <date>
Pairs with <owner/repo> <tag>. Deploy order: <backend, web, mobile>.

### Changes
#### Fixed
- <what changed, one line> (#123, owner/repo#45)

### For testers
| Change | Where (role, screen) | Steps | Expected | Locales / sizes |
|---|---|---|---|---|
Re-check: <areas around the change>

### For devops
| Item | Action | Environments | Rollback |
|---|---|---|---|
| Env vars | <NAME: purpose, where documented> or None | | |
| Migrations | <file> or None | | |
| Scripts / backfills | <command> or None | | |
| Services / jobs | <new queue, cron> or None | | |
```

# Release

Goal: a clear go or no-go for promoting a release, with drafted notes. A person tags and deploys.

1. Ask which release (a Release field value) and which promotion (for example `test` to `main`), unless the user said.
2. `node ${CLAUDE_SKILL_DIR}/../setting-up-project-tracking/scripts/board.mjs list --release <R>`.
3. Compare with what actually merged into the base since the last tag: `git log <last tag>..origin/<base> --merges --oneline` in each repo.
   - Merged, but the issue has no Release: set it with `board.mjs set <ref> --release <R>`.
   - Carries the Release, but has not merged: it is not in this release. List it.
4. Run the writing-release-notes skill for the drafts.
5. Go/no-go list, each line with its evidence:
   - open issues in the release with priority High or a `security` label;
   - On test issues nobody verified (the verifying-fixes skill has not closed them);
   - database migrations and environment or config changes in the merged PRs (files under the migrations folder, `.env.example`, config files), which DevOps must know before deploying;
   - failing checks on the base.
6. Verdict: GO when the list is empty or every item has an owner's written OK, else NO-GO with the blockers.
7. Notes: `## Release <R>` with the verdict, the go/no-go list, the release note drafts' links, and "Tag and deploy are for a person."

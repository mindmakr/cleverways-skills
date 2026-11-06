# Project reviewer brief

You review one pull request for the project described in `.agents/project-profile.md`. Read the profile first, including any `Shared:` profile it links to. You change nothing.

## Inputs you are given

- The PR number, its repo, and the range to review: the whole PR in round 1, `<from>..<head>` after.
- `dir`, a worktree at the PR head, and `diff`, the command that prints the range (`git -C "<dir>" diff <from>..<head>`). Read the profile and code in `dir` by full path; never `cd`. Open any file you need to follow the changed code, but report only problems in the range or caused by it. Rate severity by impact, the same in every round (see `correctness-brief.md`, step 5).
- The linked issues and their acceptance checklists.
- Open findings from earlier rounds, with their quoted code.

## Check, in this order

1. **Coverage.** For every acceptance item of every linked issue, mark it covered, partial or missing, and cite the code or test that proves it. An item with no proof is "missing", not "probably covered".
2. **Earlier findings.** For each open finding, say whether its quoted code is gone or changed so that the problem no longer exists (fixed), or is still there (open).
3. **What the change does at run time.** Fixes are where new defects hide, so read every changed function whole, with what it calls and what calls it, and ask of each:
   - Concurrency: locks and transactions (does code inside one need another connection from the same pool, or hold one while waiting?), two callers at once, the same write or message happening twice.
   - Existing data: the first run after deploy over rows written before the change (scans, backfills, mass notices to old cases).
   - Start-up and order: work done per record at boot or before the service is ready; side effects (mail, notices, external calls) before the write they report is saved, or after it failed.
   - Who is told what: each message, note or log reaches exactly the people the code's own rules allow, with nothing internal in it.
4. **Profile non-negotiables.** Check each rule in the profile against the diff. Typical ones: where business logic lives, money units, every locale present, migrations made only with the tool, additive API for separately released clients, no fallbacks or shims, tenant and role scoping.
5. **Cross-surface.** Every related repo and layer the profile lists: does the change need a matching change there, and is it in a linked PR?
6. **Tests.** Tests exist for the changed behaviour, use the issue's figures, and would fail without the fix.

## Output: JSON only

```json
{
  "coverage": [{ "issue": 12, "item": "text", "status": "covered|partial|missing", "evidence": "path:line or test name" }],
  "earlier": [{ "id": "R1", "status": "fixed|open", "evidence": "…" }],
  "candidates": [{ "severity": "high|medium|low", "summary": "one line", "path": "…", "line": 0, "symbol": "…", "quote": "exact line", "why": "one line", "fix": "one line" }],
  "questions": [{ "text": "what the code cannot tell you", "options": ["a", "b"], "recommend": "a" }]
}
```

Rules:
- Every candidate quotes the exact line. If you cannot quote it, it is not a candidate.
- When correctness depends on intent or a product rule that is in neither the code nor the profile, it is a question, not a finding.
- Report no style preferences, no pre-existing problems outside the diff (at most one line, marked "not blocking"), and no guesses.

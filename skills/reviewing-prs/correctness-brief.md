# Correctness brief: one range

You look for defects in the commits pushed since the last review round of one pull request. You change nothing.

## Inputs you are given

- The PR number and repo.
- `dir`: a worktree checked out at the PR head. Read files there by full path; never `cd`.
- `diff`: the command that prints the range, `git -C "<dir>" diff <from>..<head>`. This range is what you review, not the whole PR.
- The open findings from earlier rounds, so you do not report them again.

## How

1. Run `diff` and read every hunk.
2. For each changed function, read it whole in `dir`, then what it calls and what calls it (search `dir` for its name). Fixes are where new defects hide: a change that is right on its own lines can break a caller or a lock it runs inside.
3. Ask the run-time questions in `reviewer-brief.md`, step 3, plus the usual ones: wrong logic or condition, missed case, error swallowed or thrown at the wrong place, a value from the wrong source.
4. Report a defect only when it is in the range or the range causes it. Something older that the range does not touch is at most one line, marked "not in range".
5. Rate severity by impact, exactly as for a first review of the whole PR. A defect is no less severe for being in a fix or in a small range: lost or duplicated money, records or messages, a stalled service, or data reaching the wrong people is high.

## Output: JSON only

```json
{ "candidates": [{ "severity": "high|medium|low", "summary": "one line", "path": "…", "line": 0, "symbol": "…", "quote": "exact line", "why": "one line", "fix": "one line" }] }
```

Every candidate quotes the exact line at head. If you cannot quote it, it is not a candidate. No style preferences, no guesses.

# Stale check

Run it on every issue before it enters a sprint (planning), and on the top of the next sprint's ranked list (refinement). The code an issue cites may have changed since it was investigated.

1. `node ${CLAUDE_SKILL_DIR}/scripts/scrum.mjs stale <ref>`. It reads the `path:line` citations and commit links in the issue and its comments, and prints per repo the commits on the base that touched those files since the evidence, then a verdict.
2. By verdict:
   - `unchanged`: the evidence still points at the same code. Nothing to post.
   - `changed`: read each cited claim on the current base, by the investigating-issues skill's evidence rule, and look at the listed commits first.
   - `no-evidence`: no citations, or evidence older than the stale threshold. Re-check the issue's claims the same way; add citations where you find the code.
3. After a re-check, post one comment (marked `<!-- cleverways:scrum -->`):
   ```
   Refreshed at <short sha> (base <branch>)
   - <claim>: STILL TRUE | FIXED by #<pr> | CHANGED: <what, with path:line>
   Verdict: still valid | partly fixed (remaining: …) | no longer reproduces
   ```
4. Partly fixed: edit the acceptance list down to what remains, and say so in the comment.
5. No longer reproduces: do not put it in the sprint. Set Backlog, and add "Close <ref>? It no longer reproduces on <sha>" under Questions for you.

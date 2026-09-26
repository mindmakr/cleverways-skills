# Working on this repository

- Skills live in `skills/<name>/SKILL.md`. The frontmatter holds `name` (letters, digits, hyphens) and `description`, which starts "Use when…" and states when to use the skill, not what it does.
- Keep skills generic. Project facts belong in each project's `.agents/project-profile.md`; the template is `skills/project-profile/template.md`.
- Never duplicate a rule. When a second skill needs it, reference the skill that owns it.
- Keep a SKILL.md under 500 words. A script belongs in `scripts/` inside its skill, with the skill calling it via `node`.
- Write every skill in the style of `skills/writing-plainly`.
- Validate before pushing: `claude plugin validate .`

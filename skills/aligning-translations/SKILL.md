---
name: aligning-translations
description: Use when adding or editing user-facing strings, when a screen shows a missing key or untranslated text, when checking locale parity across repos, or when adding a language.
---

# Aligning translations

Every locale has every key, the same placeholders, and a real translation.

**Required:** the project-profile skill (locale folders, base locale, format, what to register for a new locale, copy under approval) and the writing-plainly skill.

## Check parity

Run this for every locale folder in every repo the profile lists:

```
node ${CLAUDE_SKILL_DIR}/scripts/i18n-parity.mjs <dir> [<dir> ...] --base <base>
```

Outside Claude Code, `${CLAUDE_SKILL_DIR}` is this skill's folder (for example `~/.agents/skills/aligning-translations`).

- The script exits 1 on `missing`, `extra` or `empty` keys.
- It warns on `placeholder`, which means the variable names differ from the base, and on `sameAsBase`, which is probably untranslated.
- Add `--json` for the full lists.

## Fix

1. **Missing keys.** Add the key to every locale in the same change. Translate the meaning, not word for word. Keep placeholder names and plural branches identical to the base.
2. **Extra keys.** Search the code for the key. Delete it if nothing uses it; otherwise add it to the base.
3. **`sameAsBase`.** Translate it, unless it is a brand name, a code, a unit or a number.
4. **A file you edit.** Search the whole file for visible text that is not behind a key, and move it to keys.
5. **Text shared by several clients.** Keep the key where the profile says it lives. Do not copy it into each client.
6. **Right-to-left locales.** Check changed screens in the running UI.
7. **Copy under approval.** Copy the profile marks as under approval (for example email or SMS) changes only with its owner.

## Add a language

1. Ask the user for the locale code, the direction (LTR or RTL) and who reviews the translations.
2. Create `<code>.json` in every locale folder, starting from the base, then translate it.
3. Register the language everywhere the profile's "to add a locale" line lists.
4. Run the parity check until `missing` is 0. Review the `sameAsBase` list with the reviewer.

## Report

Give one table per repo: a row for each locale, with columns for missing, extra, empty, placeholder and sameAsBase counts, then what you fixed.

---
name: managing-translations
description: Use when adding or editing user-facing strings, when a screen shows a missing key or untranslated text, when checking locale parity across repos, or when adding a language.
---

# Managing translations

Every locale has every key, the same placeholders, and a real translation.

**Required:** the project-profile skill (locale folders, base locale, format, what a new locale needs registered, copy under approval) and the writing-plainly skill.

## Check parity

For every locale folder the profile lists:

```
node ${CLAUDE_SKILL_DIR}/scripts/i18n-parity.mjs <dir> [<dir> ...] --base <base>
```

Outside Claude Code, `${CLAUDE_SKILL_DIR}` is this skill's folder.

It exits 1 on `missing`, `extra`, `empty`, `syntax` and `placeholder` keys (arguments or tags differ). It warns on `sameAsBase` (probably untranslated). `--json` lists them all.

## Translate in bulk

For many keys, per locale:

1. Put its `missing` and `sameAsBase` keys in one file:
   `node ${CLAUDE_SKILL_DIR}/scripts/i18n-batch.mjs extract <dir> [<dir> ...] --locale <code> --base <base> --out <code>.batch.json`
2. Fill each `<code>` value by the file's `rules`: yourself, or one agent per locale given only that file. Never one agent per file.
3. `node ${CLAUDE_SKILL_DIR}/scripts/i18n-batch.mjs merge --in <code>.batch.json`. It writes nothing if a value is empty or its placeholders differ from the base; fix them and rerun.
4. Check parity.

## Fix

1. **Missing keys.** Add the key to every locale in the same change, with the base's placeholders and plural branches.
2. **Extra keys.** Delete the key if no code uses it; otherwise add it to the base.
3. **`sameAsBase`.** Translate it, unless it is a brand name, a code, a unit or a number.
4. **A file you edit.** Move visible text not behind a key to keys.
5. **Shared text.** Keep the key where the profile says it lives.
6. **Right-to-left locales.** Check changed screens in the running UI.
7. **Copy under approval** (the profile marks it, for example SMS) changes only with its owner.

## Add a language

1. Ask the user for the code, direction (LTR or RTL) and reviewer.
2. Translate in bulk with the new code; merge creates the file.
3. Register it where the profile's "to add a locale" line says.
4. Review the `sameAsBase` list with the reviewer.

## Report

One table per repo, a row per locale with its parity counts, then what you fixed.

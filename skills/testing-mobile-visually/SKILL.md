---
name: testing-mobile-visually
description: Use when asked to test, review or QA mobile app screens visually (Expo, React Native, Flutter or native), check layouts across languages and phone sizes, or sweep app screens before a release on a local emulator or simulator.
---

# Testing mobile visually

The app runs on a local emulator or simulator, against the local backend with seeded data. Seeded logins are local fixtures, so using them is safe. The sweep refuses an API that is not on this machine or its local network.

**Required:** the project-profile skill (its "Local run" section, the mobile part), the reporting-visual-defects skill for issues, and the writing-plainly skill.

## Set up once

- Run `node ${CLAUDE_SKILL_DIR}/scripts/setup.mjs --start-emulator <avd>`. It checks Java 17+, `adb`, the emulator and your AVDs, installs Maestro into `~/.maestro`, and cold-boots the emulator. It reports anything it cannot install, such as a JDK or an AVD. Ask the user before installing those.
- Maestro drives Expo, React Native, Flutter and native apps with the same flow files. For iOS you need a Mac with Xcode simulators.
- Expo dev-client builds: the flow taps the Metro server in the launcher, dismisses the developer menu, and steps through any first-run onboarding. `flow-template.yaml` shows the pattern.
- Before sweeping, confirm the app really calls the local API (for example the app's own log line naming the API origin). A URL in an env file is not proof.
- Two device profiles, one small (360dp wide) and one large, named in the profile.
- Flows live in `.maestro/visual/`, one file per screen, created from `flow-template.yaml` in this skill's folder. Shared steps (language, login) go in `.maestro/visual/subflows/`.
- Add `.visual-tests/` to the project's `.gitignore`.

Selectors: use a testID or accessibility id where the screen has one. Otherwise use the visible text in the locale being run. Adding testIDs to the app is a code change, so list it in the report instead of making it here.

## Steps

1. **Start the local stack.** Start the backend as the profile's Local run describes. Point the app's API URL at the host machine: `10.0.2.2` from an Android emulator, `localhost` from the iOS simulator. Start the device, then install and run the app the way the profile says (dev build or Expo Go).
2. **Scope.** Use the screens the user names. If they name none, map the changed files to screens. For a release, sweep every flow.
3. **Sweep.** Run this on each device profile:
   ```
   node ${CLAUDE_SKILL_DIR}/scripts/mobile-sweep.mjs --flows .maestro/visual --app-id <id> --api-url <url the app calls> --locales en,ar --out .visual-tests/mobile [--only <text>] [--env KEY=VALUE]
   ```
   Outside Claude Code, `${CLAUDE_SKILL_DIR}` is this skill's folder. Exit 1 means a flow failed or the app logged errors.
4. **Review the screenshots.** Check everything the testing-web-visually skill's step 4 lists, plus:
   - content under the notch or status bar;
   - the keyboard covering inputs;
   - back chevrons and icons not mirrored in right-to-left locales;
   - missing glyphs (boxes);
   - text truncated on the small device.
5. **Trace.** Cite each finding's component or string with a pinned permalink, the symbol and the quoted code, or mark it "Not traced".
6. **Report** with the reporting-visual-defects skill, naming the screen and device.
7. **Reply** in six lines or fewer: the run folder, screens × locales × devices covered, the issues opened or updated, and what was not covered.

## Framework notes

| App | `appId` | Launch |
|---|---|---|
| Expo dev build / React Native | the package or bundle id | `launchApp` |
| Expo Go | `host.exp.exponent` | `openLink: exp://10.0.2.2:8081` |
| Flutter | the package or bundle id | `launchApp`; `Semantics(identifier:)` maps to `id` |
| Native | the package or bundle id | `launchApp`; accessibility id maps to `id` |

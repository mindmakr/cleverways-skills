#!/usr/bin/env node
// One-time setup for mobile visual tests. Reports what is present, installs Maestro
// into ~/.maestro when missing, and optionally boots an emulator.
// Never edits PATH or system settings: the sweep finds every tool itself (tools.mjs).
//
// Usage: node setup.mjs [--start-emulator <avd name>]
// Exit 0 when everything a sweep needs is ready, 1 otherwise.

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adbPath, avds, devices, emulatorPath, isWindows, javaHome, javaMajor, maestroHome, maestroPath, toolEnv } from './tools.mjs';

const argv = process.argv.slice(2);
const avdArg = argv.includes('--start-emulator') ? argv[argv.indexOf('--start-emulator') + 1] : null;
const rows = [];
const row = (tool, ok, detail) => rows.push({ tool, ok, detail });

// Java 17+ (Maestro requirement). Android Studio ships one, which tools.mjs finds.
const jh = javaHome();
const major = javaMajor(jh);
row('Java 17+', major >= 17, major ? `${major} at ${jh}` : 'not found. Install a JDK 17+ (winget install Microsoft.OpenJDK.17 / brew install openjdk@17) or Android Studio.');

// Android tools.
row('adb', !!adbPath(), adbPath() ?? 'not found. Install Android SDK platform-tools (Android Studio > SDK Manager).');
row('emulator', !!emulatorPath(), emulatorPath() ?? 'not found. Install the Android Emulator (Android Studio > SDK Manager).');
row('AVDs', avds().length > 0, avds().join(', ') || 'none. Create one in Android Studio > Device Manager (a small 360dp phone and a large one).');

// Maestro.
if (!maestroPath() && major >= 17) {
  console.log('Installing Maestro into ~/.maestro …');
  const zip = join(tmpdir(), 'maestro.zip');
  const dl = spawnSync('curl', ['-fsSL', '-o', zip, 'https://github.com/mobile-dev-inc/maestro/releases/latest/download/maestro.zip'], { stdio: 'inherit' });
  if (dl.status === 0) {
    const staging = join(tmpdir(), 'maestro-extract');
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    const unzip = isWindows
      ? spawnSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force '${zip}' '${staging}'`], { stdio: 'inherit' })
      : spawnSync('unzip', ['-q', '-o', zip, '-d', staging], { stdio: 'inherit' });
    if (unzip.status === 0) {
      rmSync(maestroHome(), { recursive: true, force: true });
      // The archive holds a single top-level "maestro" folder.
      spawnSync(isWindows ? 'powershell' : 'mv', isWindows
        ? ['-NoProfile', '-Command', `Move-Item '${join(staging, 'maestro')}' '${maestroHome()}'`]
        : [join(staging, 'maestro'), maestroHome()], { stdio: 'inherit' });
    }
  }
}
const maestro = maestroPath();
const version = maestro && spawnSync(maestro, ['--version'], { env: toolEnv(), encoding: 'utf8', shell: isWindows }).stdout?.trim().split(/\r?\n/).pop();
row('Maestro', !!version, version ? `${version} at ${maestro}` : 'not installed. Needs Java 17+ first; then re-run this script.');

// Emulator.
if (avdArg && devices().length === 0 && emulatorPath()) {
  console.log(`Starting emulator ${avdArg} …`);
  // Cold boot with software graphics: a saved snapshot or host GPU can leave the device "offline".
  spawn(emulatorPath(), ['-avd', avdArg, '-no-snapshot-load', '-gpu', 'swiftshader_indirect', '-no-boot-anim'], { detached: true, stdio: 'ignore' }).unref();
  spawnSync(adbPath(), ['start-server'], { stdio: 'ignore' });
  spawnSync(adbPath(), ['wait-for-device'], { stdio: 'inherit' });
  for (let i = 0; i < 90; i++) {
    const booted = spawnSync(adbPath(), ['shell', 'getprop', 'sys.boot_completed'], { encoding: 'utf8' }).stdout?.trim();
    if (booted === '1') break;
    spawnSync(isWindows ? 'timeout' : 'sleep', isWindows ? ['/t', '2', '/nobreak'] : ['2'], { stdio: 'ignore', shell: isWindows });
  }
}
row('Device running', devices().length > 0, devices().join(', ') || `none. Start one: node setup.mjs --start-emulator <${avds()[0] ?? 'avd'}>`);

for (const r of rows) console.log(`${r.ok ? '✓' : '✗'} ${r.tool.padEnd(15)} ${r.detail}`);
process.exit(rows.every((r) => r.ok) ? 0 : 1);

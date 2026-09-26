// Finds Java, the Android SDK, adb, the emulator and Maestro without relying on PATH,
// and builds the environment child processes need. Shared by setup.mjs and mobile-sweep.mjs.

import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir, platform } from 'node:os';
import { delimiter, join } from 'node:path';

const win = platform() === 'win32';
const exe = (name) => (win ? `${name}.exe` : name);
const first = (paths) => paths.find((p) => p && existsSync(p)) ?? null;

export function onPath(cmd) {
  const r = spawnSync(win ? 'where' : 'which', [cmd], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
}

export function javaHome() {
  const candidates = [
    process.env.JAVA_HOME,
    win && 'C:/Program Files/Android/Android Studio/jbr',
    win && join(process.env.LOCALAPPDATA ?? '', 'Programs/Android Studio/jbr'),
    !win && '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
    !win && join(homedir(), 'android-studio/jbr'),
    !win && '/opt/android-studio/jbr',
  ];
  const home = candidates.find((h) => h && existsSync(join(h, 'bin', exe('java'))));
  if (home) return home;
  const java = onPath('java');
  return java ? join(java, '..', '..') : null;
}

export function javaMajor(home) {
  if (!home) return 0;
  const out = spawnSync(join(home, 'bin', exe('java')), ['-version'], { encoding: 'utf8' }).stderr ?? '';
  const m = out.match(/version "(\d+)/);
  return m ? Number(m[1]) : 0;
}

export function androidSdk() {
  return first([
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    win && join(process.env.LOCALAPPDATA ?? '', 'Android/Sdk'),
    !win && join(homedir(), 'Library/Android/sdk'),
    !win && join(homedir(), 'Android/Sdk'),
  ]);
}

export const adbPath = () => { const sdk = androidSdk(); return (sdk && first([join(sdk, 'platform-tools', exe('adb'))])) ?? onPath('adb'); };
export const emulatorPath = () => { const sdk = androidSdk(); return (sdk && first([join(sdk, 'emulator', exe('emulator'))])) ?? onPath('emulator'); };

export const maestroHome = () => join(homedir(), '.maestro');
export function maestroPath() {
  return first([join(maestroHome(), 'bin', win ? 'maestro.bat' : 'maestro')]) ?? onPath('maestro');
}

export function avds() {
  const emu = emulatorPath();
  if (!emu) return [];
  return (spawnSync(emu, ['-list-avds'], { encoding: 'utf8' }).stdout ?? '').split(/\r?\n/).filter((l) => l && !l.startsWith('INFO'));
}

export function devices() {
  const adb = adbPath();
  if (!adb) return [];
  return (spawnSync(adb, ['devices'], { encoding: 'utf8' }).stdout ?? '').split(/\r?\n/).slice(1).filter((l) => /\tdevice$/.test(l)).map((l) => l.split('\t')[0]);
}

/** Environment for child processes: JAVA_HOME set, and java, adb, emulator and maestro on PATH. */
export function toolEnv() {
  const env = { ...process.env };
  // The JVM's default reservations (about 1 GB of class space, a heap of 1/64 of RAM) fail with
  // "paging file is too small" once an emulator and dev servers hold the commit limit on Windows.
  env.JAVA_TOOL_OPTIONS ??= '-Xms64m -Xmx512m -XX:CompressedClassSpaceSize=128m -XX:ReservedCodeCacheSize=64m';
  const jh = javaHome();
  if (jh) env.JAVA_HOME = jh;
  const sdk = androidSdk();
  if (sdk) env.ANDROID_HOME ??= sdk;
  const dirs = [jh && join(jh, 'bin'), adbPath() && join(adbPath(), '..'), emulatorPath() && join(emulatorPath(), '..'), join(maestroHome(), 'bin')].filter(Boolean);
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  env[key] = [...dirs, env[key]].join(delimiter);
  return env;
}

export const isWindows = win;
export const listDir = (d) => (existsSync(d) ? readdirSync(d) : []);

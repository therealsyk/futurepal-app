// Compila o APK assinado do Android e copia-o para release/android/FuturePal-<versão>.apk.
// Precisa: Android SDK (D:\Android SDK), Java 21 (C:\Users\rafae\tools\jdk21) e android/keystore.properties.
// Uso: npm run android:apk
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const env = {
  ...process.env,
  JAVA_HOME: process.env.FP_JAVA_HOME || String.raw`C:\Users\rafae\tools\jdk21`,
  ANDROID_HOME: process.env.FP_ANDROID_HOME || String.raw`D:\Android SDK`,
};
if (!existsSync(join(root, 'android', 'keystore.properties'))) {
  console.error('Falta android/keystore.properties (copia de C:/Users/rafae/FuturePal-keys). Sem isto o APK não fica assinado.');
  process.exit(1);
}
const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
execSync(`${gradlew} assembleRelease --no-daemon -q`, { cwd: join(root, 'android'), stdio: 'inherit', env, shell: true });
const out = join(root, 'release', 'android');
mkdirSync(out, { recursive: true });
const dest = join(out, `FuturePal-${version}.apk`);
copyFileSync(join(root, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'), dest);
console.log(`\nAPK pronto: ${dest}`);

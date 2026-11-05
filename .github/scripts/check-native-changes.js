// Decides whether a push to the mobile app can be shipped as an over-the-air
// (EAS) update, or needs a new app build because native code changed.
//
// Usage: node check-native-changes.js <before-sha> <after-sha>
// Writes native=true|false to $GITHUB_OUTPUT and explains why.
//
// OTA updates only replace JavaScript and assets. Installed apps would crash
// or misbehave if an update needed native code they don't have, so these
// count as native changes:
//   - anything under mobile-app/android or mobile-app/ios
//   - added/removed/changed dependencies in mobile-app/package.json
//   - any app.json change outside expo.extra (plugins, permissions,
//     runtimeVersion, package name...); expo.extra is read at runtime

const { execFileSync } = require('child_process');
const fs = require('fs');

const [before, after] = process.argv.slice(2);
const APP = 'mobile-app';

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function fileAt(sha, file) {
  try { return git('show', `${sha}:${file}`); } catch { return null; }
}

function setOutput(native, reasons) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `native=${native}\n`);
  if (native) {
    console.log('::error::This change needs a new app build, so no over-the-air update was published.');
    for (const r of reasons) console.log(`::error::${r}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        `### New app build needed\n\nThese changes can't reach installed apps over the air:\n\n${reasons.map((r) => `- ${r}`).join('\n')}\n\n` +
        'Build and share a new APK: `npx eas-cli@latest build -p android --profile preview`\n');
    }
  } else {
    console.log('JavaScript-only change: safe to publish as an over-the-air update.');
  }
}

// Manual runs and brand-new branches have no "before" commit to compare with
if (!before || /^0+$/.test(before)) {
  setOutput(false, []);
  process.exit(0);
}

const changed = git('diff', '--name-only', before, after, '--', APP).split('\n').filter(Boolean);
const reasons = [];

const nativeFiles = changed.filter((f) => f.startsWith(`${APP}/android/`) || f.startsWith(`${APP}/ios/`));
if (nativeFiles.length) reasons.push(`Native project files changed: ${nativeFiles.slice(0, 5).join(', ')}${nativeFiles.length > 5 ? ', ...' : ''}`);

if (changed.includes(`${APP}/package.json`)) {
  const deps = (sha) => {
    const pkg = JSON.parse(fileAt(sha, `${APP}/package.json`) || '{}');
    return JSON.stringify({ ...pkg.dependencies, ...pkg.devDependencies });
  };
  if (deps(before) !== deps(after)) reasons.push('App libraries (package.json dependencies) changed');
}

if (changed.includes(`${APP}/app.json`)) {
  const withoutExtra = (sha) => {
    const config = JSON.parse(fileAt(sha, `${APP}/app.json`) || '{}');
    if (config.expo) delete config.expo.extra;
    return JSON.stringify(config);
  };
  if (withoutExtra(before) !== withoutExtra(after)) reasons.push('app.json settings changed (plugins, permissions, version or runtime)');
}

setOutput(reasons.length > 0, reasons);

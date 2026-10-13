#!/usr/bin/env bash
# Builds the signed Android app for the download page (DESIGN.md → v2, Android app). Run by the deploy workflow's android
# job; writes dist/client/download/bbt.apk and android.json (its version, for "Update available"), which the deploy job
# adds to the site.
# Needs the GitHub secrets ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD
# and GOOGLE_SERVICES_JSON (see SETUP.md); without the keystore it builds nothing.
set -euo pipefail

if [[ -z "${ANDROID_KEYSTORE_BASE64:-}" ]]; then
  echo "::notice::Android app not built: the signing secrets aren't set (SETUP.md → Android app)."
  exit 0
fi

export ANDROID_KEYSTORE_FILE="$RUNNER_TEMP/bbt-release.jks"
base64 -d <<<"$ANDROID_KEYSTORE_BASE64" >"$ANDROID_KEYSTORE_FILE"
if [[ -n "${GOOGLE_SERVICES_JSON:-}" ]]; then
  printf '%s' "$GOOGLE_SERVICES_JSON" >android/app/google-services.json
else
  echo "::warning::GOOGLE_SERVICES_JSON isn't set: the app is built without notifications."
fi

npx cap sync android
(cd android && ./gradlew --no-daemon assembleRelease)

out=dist/client/download
mkdir -p "$out"
cp android/app/build/outputs/apk/release/app-release.apk "$out/bbt.apk"
code=$(sed -n 's/^ *versionCode \([0-9]*\).*/\1/p' android/app/build.gradle)
name=$(sed -n 's/^ *versionName "\(.*\)".*/\1/p' android/app/build.gradle)
printf '{"versionCode":%s,"versionName":"%s"}\n' "$code" "$name" >"$out/android.json"
rm -f "$ANDROID_KEYSTORE_FILE" android/app/google-services.json
echo "Built BBT for Android $name ($code), $(du -h "$out/bbt.apk" | cut -f1)"
echo "built=true" >>"${GITHUB_OUTPUT:-/dev/null}"

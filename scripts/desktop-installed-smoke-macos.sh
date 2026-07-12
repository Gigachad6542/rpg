#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
bundle_root="$project_root/src-tauri/target/release/bundle/dmg"
dmg_files=("$bundle_root"/*.dmg)
if [[ ! -f "${dmg_files[0]:-}" ]]; then
  echo "No packaged macOS DMG found under $bundle_root. Run pnpm desktop:build first." >&2
  exit 1
fi

work_root="$(mktemp -d "${TMPDIR:-/tmp}/local-first-ai-rpg-macos-smoke.XXXXXX")"
mount_point="$work_root/mount"
install_root="$work_root/install"
app_data_root="$work_root/app-data"
mkdir -p "$mount_point" "$install_root" "$app_data_root"
mounted=0
app_pid=""

cleanup() {
  if [[ -n "$app_pid" ]] && kill -0 "$app_pid" 2>/dev/null; then
    kill "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
  fi
  if [[ "$mounted" -eq 1 ]]; then
    hdiutil detach "$mount_point" -quiet || true
  fi
  rm -rf "$work_root"
}
trap cleanup EXIT

hdiutil attach "${dmg_files[0]}" -readonly -nobrowse -mountpoint "$mount_point" -quiet
mounted=1
packaged_app="$(find "$mount_point" -maxdepth 1 -type d -name '*.app' -print -quit)"
if [[ -z "$packaged_app" ]]; then
  echo "Mounted DMG does not contain an app bundle." >&2
  exit 1
fi

installed_app="$install_root/$(basename "$packaged_app")"
ditto "$packaged_app" "$installed_app"
app_binary="$(find "$installed_app/Contents/MacOS" -maxdepth 1 -type f -perm -111 -print -quit)"
if [[ -z "$app_binary" ]]; then
  echo "Installed app bundle does not contain an executable." >&2
  exit 1
fi

database_path="$app_data_root/local-first-ai-rpg-runtime.db"
launch_and_wait() {
  env LOCAL_FIRST_AI_RPG_RUNTIME_APP_DATA_DIR="$app_data_root" "$app_binary" >"$work_root/app.log" 2>&1 &
  app_pid=$!
  for _ in {1..30}; do
    if [[ -s "$database_path" ]] && kill -0 "$app_pid" 2>/dev/null; then
      kill "$app_pid"
      wait "$app_pid" 2>/dev/null || true
      app_pid=""
      return 0
    fi
    if ! kill -0 "$app_pid" 2>/dev/null; then
      cat "$work_root/app.log" >&2 || true
      echo "Packaged macOS app exited before persistence initialization." >&2
      exit 1
    fi
    sleep 1
  done
  echo "Packaged macOS app did not initialize SQLite within 30 seconds." >&2
  exit 1
}

launch_and_wait
sqlite3 "$database_path" "PRAGMA integrity_check;" | grep -qx "ok"
launch_and_wait
sqlite3 "$database_path" "PRAGMA integrity_check;" | grep -qx "ok"
echo "Packaged macOS smoke passed: mounted DMG, copied app, and relaunched against durable SQLite data."

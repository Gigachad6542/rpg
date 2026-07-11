// Asserts package.json, src-tauri/tauri.conf.json, and src-tauri/Cargo.toml
// agree on the app version, and — when running for a git tag (release) — that
// the tag matches too. Prevents shipping a v0.2.0 tag whose binaries still
// report 0.1.0.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  console.error(`Version sync check failed: ${message}`);
  process.exit(1);
}

const packageVersion = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
const tauriVersion = JSON.parse(readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8")).version;
const cargoToml = readFileSync(resolve(root, "src-tauri/Cargo.toml"), "utf8");
const cargoMatch = cargoToml.match(/^version\s*=\s*"([^"]+)"/m);
if (!cargoMatch) {
  fail("could not find a version in src-tauri/Cargo.toml");
}
const cargoVersion = cargoMatch[1];

if (packageVersion !== tauriVersion || packageVersion !== cargoVersion) {
  fail(
    `manifests disagree: package.json=${packageVersion} tauri.conf.json=${tauriVersion} Cargo.toml=${cargoVersion}`,
  );
}

const tag =
  process.argv[2] ?? (process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : "");
if (tag) {
  const tagVersion = tag.replace(/^v/, "");
  if (tagVersion !== packageVersion) {
    fail(`git tag ${tag} does not match manifest version ${packageVersion}`);
  }
}

console.log(`Version sync OK: ${packageVersion}${tag ? ` (tag ${tag})` : ""}`);

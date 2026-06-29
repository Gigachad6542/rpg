import { existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatedPaths = ["dist", "coverage", "src-tauri/target"];
const reasoningScratchDir = resolve(root, ".reasoning/current");

for (const path of generatedPaths) {
  removePath(resolve(root, path), path);
}

if (existsSync(reasoningScratchDir)) {
  for (const entry of readdirSync(reasoningScratchDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".log")) {
      removePath(resolve(reasoningScratchDir, entry.name), `.reasoning/current/${entry.name}`);
    }
  }
}

function removePath(target, label) {
  assertInsideProject(target);

  if (!existsSync(target)) {
    console.log(`skip ${label}`);
    return;
  }

  rmSync(target, { recursive: true, force: true });
  console.log(`removed ${label}`);
}

function assertInsideProject(target) {
  const pathFromRoot = relative(root, target);
  if (!pathFromRoot || pathFromRoot.startsWith("..")) {
    throw new Error(`Refusing to remove path outside project: ${target}`);
  }
}

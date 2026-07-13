import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readdir, readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

const platform = readRequiredArgument("--platform");
if (!new Set(["windows", "macos"]).has(platform)) {
  throw new Error("--platform must be windows or macos.");
}
const bundleRoot = resolve(readRequiredArgument("--bundle-root"));
const sbomPath = resolve(readRequiredArgument("--sbom"));
const outputRoot = resolve(readRequiredArgument("--output-dir"));
const expectedCommit = process.env.RELEASE_COMMIT?.trim();
if (!expectedCommit) {
  throw new Error("RELEASE_COMMIT is required so provenance cannot float across commits.");
}

// Commit identity is resolved with `git rev-parse HEAD` and compared exactly.
const sourceCommit = run("git", ["rev-parse", "HEAD"]).trim();
if (sourceCommit !== expectedCommit) {
  throw new Error(`Release checkout mismatch: expected ${expectedCommit}, found ${sourceCommit}.`);
}
const sourceStatus = run("git", ["status", "--porcelain", "--untracked-files=no"]).trim();
if (sourceStatus) {
  throw new Error("Release provenance requires a clean tracked-file checkout.");
}

const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));
const tauriConfig = JSON.parse(await readFile(resolve("src-tauri/tauri.conf.json"), "utf8"));
const extensions = platform === "windows" ? [".msi", ".exe"] : [".dmg"];
const artifactPaths = (await walk(bundleRoot))
  .filter((path) => extensions.some((extension) => path.toLowerCase().endsWith(extension)))
  .sort();
if (artifactPaths.length === 0) {
  throw new Error(`No ${platform} release artifacts found below ${bundleRoot}.`);
}

const artifacts = [];
for (const path of artifactPaths) {
  const details = await stat(path);
  artifacts.push({
    name: basename(path),
    relativePath: relative(bundleRoot, path).replaceAll("\\", "/"),
    bytes: details.size,
    sha256: await sha256(path),
  });
}
const sbom = {
  name: basename(sbomPath),
  bytes: (await stat(sbomPath)).size,
  sha256: await sha256(sbomPath),
};

const provenance = {
  schema: "rpg.release-provenance",
  version: 1,
  product: tauriConfig.productName,
  identifier: tauriConfig.identifier,
  productVersion: packageJson.version,
  platform,
  sourceCommit,
  sourceRef: process.env.GITHUB_REF ?? null,
  repository: process.env.GITHUB_REPOSITORY ?? null,
  workflow: process.env.GITHUB_WORKFLOW ?? null,
  workflowRunId: process.env.GITHUB_RUN_ID ?? null,
  workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  generatedAt: new Date().toISOString(),
  sbom,
  artifacts,
};

await mkdir(outputRoot, { recursive: true });
const checksumPath = join(outputRoot, `SHA256SUMS-${platform}.txt`);
const provenancePath = join(outputRoot, `release-provenance-${platform}.json`);
await writeFile(checksumPath, `${artifacts.map((artifact) => `${artifact.sha256}  ${artifact.name}`).join("\n")}\n`, "utf8");
await writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ checksumPath, provenancePath, artifacts: artifacts.length })}\n`);

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(path));
    else if (entry.isFile()) output.push(path);
  }
  return output;
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function run(command, args) {
  const executable = process.platform === "win32" && command === "git" ? "git.exe" : command;
  const result = spawnSync(executable, args, { cwd: process.cwd(), encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed.`);
  return result.stdout;
}

function readRequiredArgument(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`${name} is required.`);
  return value;
}

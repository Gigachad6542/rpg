import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

// CycloneDX release SBOM combines `pnpm list` and `cargo metadata` output.
const outputPath = resolve(readArgument("--output") ?? "release-evidence/sbom.cdx.json");
const packageManager = process.env.npm_execpath
  ? { command: process.execPath, prefix: [process.env.npm_execpath] }
  : { command: process.platform === "win32" ? "pnpm.cmd" : "pnpm", prefix: [] };
const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";

const pnpmGraph = runJson(packageManager.command, [
  ...packageManager.prefix,
  "list",
  "--prod",
  "--depth",
  "Infinity",
  "--json",
]);
const cargoGraph = runJson(cargo, [
  "metadata",
  "--locked",
  "--format-version",
  "1",
  "--manifest-path",
  "src-tauri/Cargo.toml",
]);

const rootPackage = Array.isArray(pnpmGraph) ? pnpmGraph[0] : pnpmGraph;
if (!rootPackage || typeof rootPackage !== "object") {
  throw new Error("pnpm list did not return a root package graph.");
}
if (!cargoGraph || !Array.isArray(cargoGraph.packages)) {
  throw new Error("cargo metadata did not return a package graph.");
}

const components = new Map();
collectPnpmDependencies(rootPackage.dependencies, components);
for (const pkg of cargoGraph.packages) {
  if (!pkg?.name || !pkg?.version) continue;
  const purl = `pkg:cargo/${encodeURIComponent(pkg.name)}@${encodeURIComponent(pkg.version)}`;
  components.set(purl, {
    type: cargoGraph.workspace_members?.includes(pkg.id) ? "application" : "library",
    "bom-ref": purl,
    name: pkg.name,
    version: pkg.version,
    purl,
    ...(Array.isArray(pkg.license) ? {} : pkg.license ? { licenses: [{ expression: pkg.license }] } : {}),
  });
}

const applicationName = typeof rootPackage.name === "string" ? rootPackage.name : "rpg";
const applicationVersion = typeof rootPackage.version === "string" ? rootPackage.version : "0.0.0";
const applicationRef = `pkg:npm/${npmPurlName(applicationName)}@${encodeURIComponent(applicationVersion)}`;
const sortedComponents = [...components.values()].sort((left, right) => left["bom-ref"].localeCompare(right["bom-ref"]));
const bom = {
  $schema: "https://cyclonedx.org/schema/bom-1.6.schema.json",
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  serialNumber: `urn:uuid:${randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: {
      components: [
        {
          type: "application",
          name: "pnpm",
          version: commandVersion(packageManager.command, [...packageManager.prefix, "--version"]),
        },
        { type: "application", name: "cargo", version: commandVersion(cargo, ["--version"]) },
        { type: "application", name: "phase2-release-sbom-generator", version: "1" },
      ],
    },
    component: {
      type: "application",
      "bom-ref": applicationRef,
      name: applicationName,
      version: applicationVersion,
      purl: applicationRef,
    },
  },
  components: sortedComponents,
  dependencies: [
    { ref: applicationRef, dependsOn: sortedComponents.map((component) => component["bom-ref"]) },
    ...sortedComponents.map((component) => ({ ref: component["bom-ref"], dependsOn: [] })),
  ],
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(bom, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ output: outputPath, components: sortedComponents.length })}\n`);

function collectPnpmDependencies(dependencies, target) {
  if (!dependencies || typeof dependencies !== "object") return;
  for (const [name, dependency] of Object.entries(dependencies)) {
    if (!dependency || typeof dependency !== "object" || typeof dependency.version !== "string") continue;
    const purl = `pkg:npm/${npmPurlName(name)}@${encodeURIComponent(dependency.version)}`;
    if (!target.has(purl)) {
      target.set(purl, {
        type: "library",
        "bom-ref": purl,
        name,
        version: dependency.version,
        purl,
      });
    }
    collectPnpmDependencies(dependency.dependencies, target);
  }
}

function npmPurlName(name) {
  return encodeURIComponent(name).replace(/%2F/gi, "/");
}

function runJson(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.status !== 0) {
    const detail = result.error?.message ?? result.stderr ?? result.stdout ?? "unknown process failure";
    throw new Error(`${command} ${args.join(" ")} failed: ${String(detail).trim().slice(0, 1_000)}`);
  }
  return JSON.parse(result.stdout);
}

function commandVersion(command, args) {
  const result = spawnSync(command, args, { cwd: process.cwd(), encoding: "utf8", windowsHide: true });
  return result.status === 0 ? result.stdout.trim().slice(0, 100) : "unknown";
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

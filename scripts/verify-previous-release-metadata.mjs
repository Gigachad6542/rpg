import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const msiPath = resolve(readRequiredArgument("--msi"));
const checksumPath = resolve(readRequiredArgument("--checksums"));
const provenancePath = resolve(readRequiredArgument("--provenance"));
const previousTag = readRequiredArgument("--previous-tag");
const currentVersion = readRequiredArgument("--current-version");
const expectedRepository = readRequiredArgument("--expected-repository");
const expectedSourceCommit = readRequiredArgument("--expected-source-commit").toLowerCase();
const outputPath = resolve(readRequiredArgument("--output"));

const previousVersion = parseStableTag(previousTag);
const currentSemver = parseStableVersion(currentVersion, "current version");
if (compareVersions(previousVersion, currentSemver) >= 0) {
  throw new Error(
    `Previous release ${previousTag} must be strictly older than candidate ${currentVersion}.`,
  );
}
if (!/^[a-f0-9]{40}$/.test(expectedSourceCommit)) {
  throw new Error("--expected-source-commit must be the 40-character release tag commit SHA.");
}

const [msiBytes, checksumBytes, provenanceBytes] = await Promise.all([
  readFile(msiPath),
  readFile(checksumPath),
  readFile(provenancePath),
]);
const msiName = basename(msiPath);
const msiSha256 = sha256(msiBytes);
const checksumEntries = parseChecksumManifest(checksumBytes.toString("utf8"));
const matchingChecksums = checksumEntries.filter((entry) => entry.name === msiName);
if (matchingChecksums.length !== 1) {
  throw new Error(
    `Checksum manifest must contain exactly one SHA-256 entry for ${msiName}; found ${matchingChecksums.length}.`,
  );
}
if (matchingChecksums[0].sha256 !== msiSha256) {
  throw new Error(`Checksum manifest SHA-256 does not match ${msiName}.`);
}

const provenance = parseJsonObject(provenanceBytes, "release provenance");
requireEqual(provenance.schema, "rpg.release-provenance", "provenance schema");
requireEqual(provenance.version, 1, "provenance version");
requireEqual(provenance.platform, "windows", "provenance platform");
requireEqual(provenance.product, "Local-First RPG", "provenance product");
requireEqual(
  provenance.identifier,
  "com.localfirst.airpgruntime",
  "provenance application identifier",
);
requireEqual(provenance.productVersion, previousVersion.raw, "provenance product version");
requireEqual(provenance.repository, expectedRepository, "provenance repository");

if (typeof provenance.sourceCommit !== "string" || !/^[a-fA-F0-9]{40}$/.test(provenance.sourceCommit)) {
  throw new Error("Release provenance source commit must be a 40-character Git SHA.");
}
if (provenance.sourceCommit.toLowerCase() !== expectedSourceCommit) {
  throw new Error(
    `Release provenance source commit ${provenance.sourceCommit} does not match release tag commit ${expectedSourceCommit}.`,
  );
}
if (!Array.isArray(provenance.artifacts)) {
  throw new Error("Release provenance artifacts must be an array.");
}
const matchingArtifacts = provenance.artifacts.filter(
  (artifact) => artifact && typeof artifact === "object" && artifact.name === msiName,
);
if (matchingArtifacts.length !== 1) {
  throw new Error(
    `Release provenance must contain exactly one artifact named ${msiName}; found ${matchingArtifacts.length}.`,
  );
}
const artifact = matchingArtifacts[0];
if (artifact.sha256 !== msiSha256) {
  throw new Error(`Release provenance SHA-256 does not match ${msiName}.`);
}
const msiStat = await stat(msiPath);
if (artifact.bytes !== msiStat.size) {
  throw new Error(`Release provenance byte count does not match ${msiName}.`);
}

const evidence = {
  schema: "rpg.release.previous-windows-verification",
  version: 1,
  status: "pass",
  verifiedAt: new Date().toISOString(),
  previousTag,
  previousVersion: previousVersion.raw,
  currentVersion: currentSemver.raw,
  repository: expectedRepository,
  sourceCommit: expectedSourceCommit,
  msi: {
    name: msiName,
    bytes: msiStat.size,
    sha256: msiSha256,
  },
  checksumManifest: {
    name: basename(checksumPath),
    sha256: sha256(checksumBytes),
  },
  provenance: {
    name: basename(provenancePath),
    sha256: sha256(provenanceBytes),
  },
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(evidence)}\n`);

function parseStableTag(tag) {
  if (!tag.startsWith("v")) {
    throw new Error(`Previous release tag ${tag} must use the vMAJOR.MINOR.PATCH form.`);
  }
  return parseStableVersion(tag.slice(1), "previous release tag");
}

function parseStableVersion(value, label) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match) {
    throw new Error(`${label} ${value} must be a stable MAJOR.MINOR.PATCH version.`);
  }
  return {
    raw: value,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareVersions(left, right) {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

function parseChecksumManifest(raw) {
  const entries = [];
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const match = /^([a-fA-F0-9]{64}) {2}([^\\/]+)$/.exec(line);
    if (!match || match[2] === "." || match[2] === "..") {
      throw new Error(`Invalid checksum manifest entry on line ${index + 1}.`);
    }
    entries.push({ sha256: match[1].toLowerCase(), name: match[2] });
  }
  if (entries.length === 0) throw new Error("Checksum manifest is empty.");
  return entries;
}

function parseJsonObject(bytes, label) {
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(
      `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed;
}

function requireEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`);
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readRequiredArgument(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`${name} is required.`);
  return value;
}

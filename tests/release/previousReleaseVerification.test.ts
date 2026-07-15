import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const workspaceRoot = process.cwd();
const verifierPath = join(
  workspaceRoot,
  "scripts",
  "verify-previous-release-metadata.mjs",
);
const temporaryRoots: string[] = [];

type Fixture = {
  root: string;
  msiPath: string;
  checksumPath: string;
  provenancePath: string;
  evidencePath: string;
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createFixture(
  overrides: {
    checksum?: string;
    previousVersion?: string;
    provenanceRepository?: string;
    artifactSha256?: string;
  } = {},
): Fixture {
  const root = mkdtempSync(join(tmpdir(), "rpg-previous-release-test-"));
  temporaryRoots.push(root);

  const msiPath = join(root, "Local-First RPG_0.1.0_x64_en-US.msi");
  const checksumPath = join(root, "SHA256SUMS-windows.txt");
  const provenancePath = join(root, "release-provenance-windows.json");
  const evidencePath = join(root, "previous-release-verification.json");
  const msiBytes = Buffer.from("synthetic MSI fixture for release metadata verification");
  const actualSha256 = createHash("sha256").update(msiBytes).digest("hex");
  const previousVersion = overrides.previousVersion ?? "0.1.0";

  writeFileSync(msiPath, msiBytes);
  writeFileSync(
    checksumPath,
    overrides.checksum ?? `${actualSha256}  ${basename(msiPath)}\n`,
    "utf8",
  );
  writeFileSync(
    provenancePath,
    `${JSON.stringify({
      schema: "rpg.release-provenance",
      version: 1,
      product: "Local-First RPG",
      identifier: "com.localfirst.airpgruntime",
      productVersion: previousVersion,
      platform: "windows",
      sourceCommit: "1".repeat(40),
      sourceRef: `refs/tags/v${previousVersion}`,
      repository: overrides.provenanceRepository ?? "Gigachad6542/rpg",
      workflow: "Release",
      workflowRunId: "1234",
      workflowRunAttempt: "1",
      generatedAt: "2026-07-14T12:00:00.000Z",
      sbom: {
        name: "sbom-windows.cdx.json",
        bytes: 100,
        sha256: "2".repeat(64),
      },
      artifacts: [
        {
          name: basename(msiPath),
          relativePath: `msi/${basename(msiPath)}`,
          bytes: msiBytes.length,
          sha256: overrides.artifactSha256 ?? actualSha256,
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );

  return { root, msiPath, checksumPath, provenancePath, evidencePath };
}

function runVerifier(
  fixture: Fixture,
  options: { currentVersion?: string; previousTag?: string } = {},
) {
  return spawnSync(
    process.execPath,
    [
      verifierPath,
      "--msi",
      fixture.msiPath,
      "--checksums",
      fixture.checksumPath,
      "--provenance",
      fixture.provenancePath,
      "--previous-tag",
      options.previousTag ?? "v0.1.0",
      "--current-version",
      options.currentVersion ?? "0.2.0",
      "--expected-repository",
      "Gigachad6542/rpg",
      "--output",
      fixture.evidencePath,
    ],
    { cwd: workspaceRoot, encoding: "utf8", windowsHide: true },
  );
}

describe("previous Windows release metadata verification", () => {
  it("accepts an older release only when checksum and provenance bind the exact MSI", () => {
    const fixture = createFixture();

    const result = runVerifier(fixture);

    expect(result.status, result.stderr).toBe(0);
    const evidence = JSON.parse(readFileSync(fixture.evidencePath, "utf8")) as {
      schema: string;
      status: string;
      previousTag: string;
      previousVersion: string;
      currentVersion: string;
      sourceCommit: string;
      msi: { sha256: string };
    };
    expect(evidence).toMatchObject({
      schema: "rpg.release.previous-windows-verification",
      status: "pass",
      previousTag: "v0.1.0",
      previousVersion: "0.1.0",
      currentVersion: "0.2.0",
      sourceCommit: "1".repeat(40),
    });
    expect(evidence.msi.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects an MSI whose checksum manifest does not match its bytes", () => {
    const fixture = createFixture({ checksum: `${"0".repeat(64)}  previous.msi\n` });

    const result = runVerifier(fixture);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/checksum|SHA-256/i);
  });

  it("rejects a previous tag that is not strictly older than the candidate", () => {
    const fixture = createFixture();

    const result = runVerifier(fixture, { currentVersion: "0.1.0" });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/strictly older/i);
  });

  it("rejects provenance from another repository or artifact digest", () => {
    const wrongRepository = createFixture({ provenanceRepository: "attacker/fork" });
    const wrongDigest = createFixture({ artifactSha256: "3".repeat(64) });

    const repositoryResult = runVerifier(wrongRepository);
    const digestResult = runVerifier(wrongDigest);

    expect(repositoryResult.status).not.toBe(0);
    expect(repositoryResult.stderr).toMatch(/repository/i);
    expect(digestResult.status).not.toBe(0);
    expect(digestResult.stderr).toMatch(/provenance|SHA-256/i);
  });
});

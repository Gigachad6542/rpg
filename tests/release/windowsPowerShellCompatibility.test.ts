import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const workspaceRoot = process.cwd();
const helperPath = join(workspaceRoot, "scripts", "windows-file-hash.ps1");
const consumers = [
  "desktop-installer-lifecycle.ps1",
  "verify-previous-windows-signature.ps1",
  "verify-windows-signatures.ps1",
];

function quotePowerShellLiteral(value: string): string {
  return `'${value.split("'").join("''")}'`;
}

describe("Windows PowerShell release-script compatibility", () => {
  it("uses the shared .NET hash helper instead of Get-FileHash", () => {
    const helper = readFileSync(helperPath, "utf8");

    expect(helper).toContain("System.Security.Cryptography.SHA256");
    expect(helper).toContain("System.IO.File");
    expect(helper).not.toContain("Get-FileHash");

    for (const consumer of consumers) {
      const script = readFileSync(join(workspaceRoot, "scripts", consumer), "utf8");
      expect(script, consumer).toContain('windows-file-hash.ps1');
      expect(script, consumer).toContain("Get-Sha256Hex");
      expect(script, consumer).not.toContain("Get-FileHash");
    }
  });

  it.runIf(process.platform === "win32")(
    "computes the same SHA-256 in every installed PowerShell runtime",
    () => {
      const root = mkdtempSync(join(tmpdir(), "rpg-powershell-hash-test-"));
      const fixturePath = join(root, "fixture.bin");
      const fixture = Buffer.from("cross-runtime SHA-256 fixture\n", "utf8");
      writeFileSync(fixturePath, fixture);

      try {
        const availableRuntimes = ["pwsh", "powershell"].filter((executable) => {
          const probe = spawnSync(
            executable,
            ["-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.ToString()"],
            { cwd: workspaceRoot, encoding: "utf8", windowsHide: true },
          );
          return !probe.error && probe.status === 0;
        });
        expect(availableRuntimes.length).toBeGreaterThan(0);
        expect(availableRuntimes).toContain("powershell");

        const expected = createHash("sha256").update(fixture).digest("hex");
        const command = [
          `. ${quotePowerShellLiteral(helperPath)}`,
          `Get-Sha256Hex -Path ${quotePowerShellLiteral(fixturePath)}`,
        ].join("; ");

        for (const executable of availableRuntimes) {
          const result = spawnSync(
            executable,
            ["-NoProfile", "-NonInteractive", "-Command", command],
            { cwd: workspaceRoot, encoding: "utf8", windowsHide: true },
          );
          expect(result.status, `${executable}: ${result.stderr}`).toBe(0);
          expect(result.stdout.trim(), executable).toBe(expected);
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it.runIf(process.platform === "win32")(
    "retains structured evidence when lifecycle validation fails safely",
    () => {
      const root = mkdtempSync(join(tmpdir(), "rpg-installer-evidence-test-"));
      const bundleRoot = join(root, "empty-bundle");
      const evidenceDir = join(root, "evidence");
      mkdirSync(bundleRoot);

      try {
        const result = spawnSync(
          "powershell",
          [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            join(workspaceRoot, "scripts", "desktop-installer-lifecycle.ps1"),
            "-BundleRoot",
            bundleRoot,
            "-EvidenceDir",
            evidenceDir,
          ],
          { cwd: workspaceRoot, encoding: "utf8", windowsHide: true },
        );

        expect(result.status).not.toBe(0);
        const evidencePath = join(evidenceDir, "windows-installer-lifecycle.json");
        expect(
          existsSync(evidencePath),
          `${result.stdout}\n${result.stderr}`,
        ).toBe(true);
        const evidence = JSON.parse(
          readFileSync(evidencePath, "utf8"),
        ) as { schema: string; status: string; failureMessage: string };
        expect(evidence).toMatchObject({
          schema: "rpg.release.windows-installer-lifecycle",
          status: "fail",
        });
        expect(evidence.failureMessage).toMatch(/existing|exactly one current NSIS installer/i);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    30_000,
  );
});

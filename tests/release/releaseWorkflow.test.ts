import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const workspaceRoot = process.cwd();

function readWorkflow(name: string) {
  return readFileSync(join(workspaceRoot, ".github", "workflows", name), "utf8");
}

function readJob(workflow: string, jobName: string) {
  const lines = workflow.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  if (start < 0) {
    throw new Error(`Expected workflow job ${jobName}`);
  }

  const end = lines.findIndex(
    (line, index) => index > start && /^ {2}[A-Za-z0-9_-]+:$/.test(line),
  );
  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

describe("release workflow", () => {
  it("publishes tagged Windows desktop artifacts with checksums", () => {
    const workflow = readWorkflow("release.yml");
    const packageJson = readFileSync(join(workspaceRoot, "package.json"), "utf8");
    const windowsSmoke = readFileSync(
      join(workspaceRoot, "scripts", "desktop-installed-smoke.ps1"),
      "utf8",
    );

    expect(workflow).toContain("tags:");
    expect(workflow).toContain("v*");
    expect(workflow).toContain("pnpm verify:release");
    expect(packageJson).toContain('"desktop:installed-smoke"');
    expect(packageJson).toContain("pnpm desktop:installed-smoke");
    expect(workflow).toContain("release:provenance");
    expect(workflow).toContain("actions/upload-artifact");
    expect(workflow).toContain("gh release create");
    expect(workflow).toContain("complete packaged product flow");
    expect(workflow).not.toContain("complete installed product flow");
    expect(windowsSmoke).toContain("MSI-payload smoke passed");
    expect(windowsSmoke).not.toContain("Installed desktop smoke passed");
    expect(workflow).toContain("$releaseFiles = @($artifacts | ForEach-Object { $_.FullName }) + @($metadata | ForEach-Object { $_.FullName })");
    expect(workflow).not.toContain("$artifacts.FullName + $checksum");
  });

  it("uses the canonical product name for public release artifacts", () => {
    const workflow = readWorkflow("release.yml");

    expect(workflow).toContain("name: local-first-rpg-windows");
    expect(workflow).toContain("name: local-first-rpg-macos");
    expect(workflow).toContain('$title = "Local-First RPG $env:GITHUB_REF_NAME"');
    expect(workflow).not.toContain("Local-First AI RPG Runtime");
  });

  it("keeps release checksums platform-specific and guards manifest versions", () => {
    const releaseWorkflow = readWorkflow("release.yml");
    const ciWorkflow = readWorkflow("ci.yml");
    const packageJson = JSON.parse(readFileSync(join(workspaceRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const windowsRelease = readJob(releaseWorkflow, "windows-desktop-release");
    const macosRelease = readJob(releaseWorkflow, "macos-desktop-release");
    const windowsVerify = readJob(ciWorkflow, "verify");

    expect(packageJson.scripts?.["verify:version"]).toBe("node scripts/verify-version.mjs");
    expect(windowsVerify).toContain("pnpm verify:version");
    expect(windowsRelease).toContain("pnpm verify:version");
    expect(macosRelease).toContain("pnpm verify:version");
    expect(windowsRelease).toContain("SHA256SUMS-windows.txt");
    expect(macosRelease).toContain("SHA256SUMS-macos.txt");
    expect(releaseWorkflow).not.toMatch(/(?:^|\/)SHA256SUMS\.txt/m);
  });

  it("provides an explicit signed bootstrap baseline without treating it as migration proof", () => {
    const workflow = readWorkflow("release.yml");
    const windowsRelease = readJob(workflow, "windows-desktop-release");

    expect(workflow).toContain("release_mode:");
    expect(workflow).toContain("bootstrap-baseline");
    expect(workflow).toContain("CREATE SIGNED BASELINE");
    expect(workflow).toContain("publish-bootstrap-baseline:");
    expect(workflow).toContain("--prerelease");
    expect(workflow).toContain("--target $env:GITHUB_SHA");
    expect(workflow).toContain("bootstrap-baseline.json");
    expect(windowsRelease).toContain("inputs.release_mode != 'bootstrap-baseline'");
    expect(windowsRelease).toContain("inputs.release_mode == 'bootstrap-baseline'");
    expect(workflow).toContain("A bootstrap baseline is not migration proof");
  });

  it("keeps pnpm supply-chain policy in the workspace config supported by current pnpm", () => {
    const packageJson = JSON.parse(readFileSync(join(workspaceRoot, "package.json"), "utf8")) as {
      pnpm?: unknown;
    };
    const workspaceConfig = readFileSync(join(workspaceRoot, "pnpm-workspace.yaml"), "utf8");

    expect(packageJson.pnpm).toBeUndefined();
    expect(workspaceConfig).toContain("overrides:");
    expect(workspaceConfig).toContain("esbuild: ^0.25.12");
    expect(workspaceConfig).toContain("vite: ^6.4.3");
    expect(workspaceConfig).toContain("onlyBuiltDependencies:");
  });

  it("runs routine macOS source and Rust verification on pushes and pull requests", () => {
    const workflow = readWorkflow("ci.yml");
    const macosVerify = readJob(workflow, "verify-macos");

    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("push:");
    expect(macosVerify).toContain("runs-on: macos-latest");
    expect(macosVerify).toContain("pnpm install --frozen-lockfile");
    expect(macosVerify).toContain("pnpm verify:version");
    expect(macosVerify).toContain("pnpm test");
    expect(macosVerify).toContain("pnpm build");
    expect(macosVerify).toContain("pnpm rust:test");
    expect(macosVerify).toContain("pnpm rust:clippy");
  });

  it("mounts and relaunches the packaged macOS app with isolated persistent data", () => {
    const workflow = readWorkflow("release.yml");
    const packageJson = JSON.parse(readFileSync(join(workspaceRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const smokeScript = readFileSync(
      join(workspaceRoot, "scripts", "desktop-installed-smoke-macos.sh"),
      "utf8",
    );

    expect(packageJson.scripts?.["desktop:installed-smoke:mac"]).toContain("desktop-installed-smoke-macos.sh");
    expect(packageJson.scripts?.["verify:release:mac"]).toContain("desktop:installed-smoke:mac");
    expect(readJob(workflow, "macos-desktop-release")).toContain("pnpm verify:release:mac");
    expect(smokeScript).toContain("hdiutil attach");
    expect(smokeScript).toContain("LOCAL_FIRST_AI_RPG_RUNTIME_APP_DATA_DIR");
    expect(smokeScript).toContain("local-first-ai-rpg-runtime.db");
    expect(smokeScript).toContain("launch_and_wait");
  });

  it("documents platform checksums and the provisional macOS release lane accurately", () => {
    const macosInstall = readFileSync(join(workspaceRoot, "docs", "macos-install.md"), "utf8");
    const releasePackaging = readFileSync(
      join(workspaceRoot, "docs", "release-packaging.md"),
      "utf8",
    );

    expect(macosInstall).toContain("SHA256SUMS-macos.txt");
    expect(macosInstall).not.toMatch(/(?:^|`)SHA256SUMS\.txt(?:`|$)/m);
    expect(macosInstall).not.toContain("produced automatically by CI and published");
    expect(releasePackaging).toContain("SHA256SUMS-windows.txt");
    expect(releasePackaging).toContain("SHA256SUMS-macos.txt");
    expect(releasePackaging).not.toContain(
      "currently treats Windows desktop packaging as the maintained release lane",
    );
  });
});

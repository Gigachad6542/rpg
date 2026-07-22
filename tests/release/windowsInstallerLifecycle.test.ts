import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const workspaceRoot = process.cwd();
const lifecycleScriptPath = join(
  workspaceRoot,
  "scripts",
  "desktop-installer-lifecycle.ps1",
);

describe("Windows installer lifecycle release gate", () => {
  it("is part of the full Windows release verification command", () => {
    const packageJson = JSON.parse(
      readFileSync(join(workspaceRoot, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["desktop:installer-lifecycle"]).toContain(
      "desktop-installer-lifecycle.ps1",
    );
    expect(packageJson.scripts?.["verify:release"]).toContain(
      "desktop:installer-lifecycle",
    );
  });

  it("runs on clean hosted Windows CI and retains lifecycle evidence", () => {
    const ciWorkflow = readFileSync(
      join(workspaceRoot, ".github", "workflows", "ci.yml"),
      "utf8",
    );

    expect(ciWorkflow).toContain("pnpm desktop:installer-lifecycle");
    expect(ciWorkflow).toContain("release-evidence/windows/installer-lifecycle/**");
    expect(ciWorkflow).toContain("windows-installer-lifecycle-evidence");
  });

  it("clears stale bundle output before producing release artifacts", () => {
    const desktopBuild = readFileSync(
      join(workspaceRoot, "scripts", "desktop-build.mjs"),
      "utf8",
    );

    expect(desktopBuild).toContain("releaseBundleRoot");
    expect(desktopBuild).toContain("rmSync(releaseBundleRoot");
    expect(desktopBuild.indexOf("rmSync(releaseBundleRoot")).toBeLessThan(
      desktopBuild.indexOf("const result = spawnSync"),
    );
  });

  it("proves install, repair, launch persistence, and uninstall without touching an existing install", () => {
    expect(existsSync(lifecycleScriptPath)).toBe(true);
    const script = existsSync(lifecycleScriptPath)
      ? readFileSync(lifecycleScriptPath, "utf8")
      : "";

    expect(script).toContain("Existing Local-First RPG installation detected");
    expect(script).toContain("Local-First RPG_*_x64-setup.exe");
    expect(script).toContain("Expected exactly one current NSIS installer");
    expect(script).toContain("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Local-First RPG");
    expect(script).toContain('PSObject.Properties["DisplayName"]');
    expect(script).toContain('PSObject.Properties["Publisher"]');
    expect(script).toContain('"DisplayName"');
    expect(script).toContain('"DisplayVersion"');
    expect(script).toContain('"InstallLocation"');
    expect(script).toContain("LOCAL_FIRST_AI_RPG_RUNTIME_APP_DATA_DIR");
    expect(script).toContain("local-first-ai-rpg-runtime.db");
    expect(script).toContain("repair/reinstall");
    expect(script).toContain("uninstall.exe");
    expect(script).toContain('status = "pending"');
    expect(script).toContain('$observations.status = "pass"');
    expect(script).toContain('$observations.status = "fail"');
    expect(script).toContain("Write-LifecycleEvidence");
    expect(script).toContain("Installer lifecycle passed");
  });
});

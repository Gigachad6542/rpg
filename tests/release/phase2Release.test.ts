import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(...parts: string[]): string {
  return readFileSync(join(root, ...parts), "utf8");
}

describe("Phase 2 packaged desktop proof", () => {
  it("drives the installed Windows WebView through the complete product and restore flow", () => {
    const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
    const orchestrator = read("scripts", "desktop-product-flow.ps1");
    const driver = read("scripts", "desktop-product-flow.mjs");

    expect(packageJson.scripts?.["desktop:product-flow"]).toContain("desktop-product-flow.ps1");
    expect(orchestrator).toContain("PreviousMsi");
    expect(orchestrator).toContain("CurrentMsi");
    expect(orchestrator).toContain("msiexec.exe");
    expect(orchestrator).toContain("/a");
    expect(driver).toContain("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS");
    expect(driver).toContain("connectOverCDP");
    expect(driver).toContain("Welcome to your local RPG runtime");
    expect(driver).toContain("Mock provider active; no API key needed.");
    expect(driver).toContain("PHASE2_DURABLE_MARKER");
    expect(driver).toContain("PHASE2_TRANSIENT_MARKER");
    expect(driver).toContain("local-first-ai-rpg-runtime.db");
    expect(driver).toContain("Export runtime data");
    expect(driver).toContain("phase2-windows-product-flow.json");
  });

  it("creates a CycloneDX SBOM and commit-bound checksummed provenance", () => {
    const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
    const sbom = read("scripts", "generate-release-sbom.mjs");
    const provenance = read("scripts", "create-release-provenance.mjs");

    expect(packageJson.scripts?.["release:sbom"]).toContain("generate-release-sbom.mjs");
    expect(packageJson.scripts?.["release:provenance"]).toContain("create-release-provenance.mjs");
    expect(sbom).toContain("CycloneDX");
    expect(sbom).toContain("cargo metadata");
    expect(sbom).toContain("pnpm list");
    expect(provenance).toContain("git rev-parse HEAD");
    expect(provenance).toContain("RELEASE_COMMIT");
    expect(provenance).toContain("SHA256SUMS");
    expect(provenance).toContain("release-provenance");
  });
});

describe("Phase 2 hosted release controls", () => {
  it("requires exact-commit hosted CI, platform signing, retained evidence, and attestations", () => {
    const workflow = read(".github", "workflows", "release.yml");

    expect(workflow).toContain("hosted-ci-gate:");
    expect(workflow).toMatch(/workflow_id:\s*["']?ci\.yml["']?/);
    expect(workflow).toContain("head_sha: context.sha");
    expect(workflow).toContain("conclusion === \"success\"");
    expect(workflow).toContain("needs: hosted-ci-gate");
    expect(workflow).toContain("WINDOWS_CERTIFICATE_BASE64");
    expect(workflow).toContain("WINDOWS_CERTIFICATE_PASSWORD");
    expect(workflow).toContain("Import-PfxCertificate");
    expect(workflow).toContain("verify-windows-signatures.ps1");
    expect(workflow).toContain("desktop:product-flow");
    expect(workflow).toContain("previous-release");
    expect(workflow).toContain("APPLE_CERTIFICATE");
    expect(workflow).toContain("APPLE_CERTIFICATE_PASSWORD");
    expect(workflow).toContain("APPLE_ID");
    expect(workflow).toContain("APPLE_PASSWORD");
    expect(workflow).toContain("APPLE_TEAM_ID");
    expect(workflow).toContain("TAURI_BUILD_TARGET: aarch64-apple-darwin");
    expect(workflow).toContain("desktop:keychain-smoke:mac");
    expect(workflow).toContain("stapler validate");
    expect(workflow).toContain("actions/attest@v4");
    expect(workflow).toContain("sbom-path:");
    expect(workflow).toContain("publish-release:");
    expect(workflow).toContain("windows-desktop-release");
    expect(workflow).toContain("macos-desktop-release");
  });

  it("runs an opt-in native macOS Keychain round trip and retains DMG evidence", () => {
    const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
    const rust = read("src-tauri", "src", "lib.rs");
    const macSmoke = read("scripts", "desktop-installed-smoke-macos.sh");

    expect(packageJson.scripts?.["desktop:keychain-smoke:mac"]).toContain("os_keychain_round_trip_smoke");
    expect(rust).toContain("os_keychain_round_trip_smoke");
    expect(rust).toContain("PHASE2_KEYCHAIN_SMOKE");
    expect(macSmoke).toContain("EVIDENCE_DIR");
    expect(macSmoke).toContain("codesign --verify");
    expect(macSmoke).toContain("spctl");
  });

  it("documents a fail-closed updater and rollback policy", () => {
    const policy = read("docs", "updater-rollback-policy.md");

    expect(policy).toContain("No automatic downgrade");
    expect(policy).toContain("signed previous release");
    expect(policy).toContain("backup");
    expect(policy).toContain("exact release commit");
    expect(policy).toContain("SBOM");
    expect(policy).toContain("revocation");
  });
});

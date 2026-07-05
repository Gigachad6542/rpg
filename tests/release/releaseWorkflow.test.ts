import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const workspaceRoot = process.cwd();

describe("release workflow", () => {
  it("publishes tagged Windows desktop artifacts with checksums", () => {
    const workflow = readFileSync(join(workspaceRoot, ".github", "workflows", "release.yml"), "utf8");
    const packageJson = readFileSync(join(workspaceRoot, "package.json"), "utf8");

    expect(workflow).toContain("tags:");
    expect(workflow).toContain("v*");
    expect(workflow).toContain("pnpm verify:release");
    expect(packageJson).toContain('"desktop:installed-smoke"');
    expect(packageJson).toContain("pnpm desktop:installed-smoke");
    expect(workflow).toContain("Get-FileHash");
    expect(workflow).toContain("actions/upload-artifact");
    expect(workflow).toContain("gh release create");
    expect(workflow).toContain("$releaseFiles = @($artifacts | ForEach-Object { $_.FullName }) + @($checksum)");
    expect(workflow).not.toContain("$artifacts.FullName + $checksum");
  });
});

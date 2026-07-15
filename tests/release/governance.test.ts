import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("release governance surfaces", () => {
  it("defines controlled-beta security, support, contribution, conduct, and changelog policy", () => {
    for (const path of [
      "SECURITY.md",
      "SUPPORT.md",
      "CONTRIBUTING.md",
      "CODE_OF_CONDUCT.md",
      "CHANGELOG.md",
    ]) {
      expect(existsSync(join(root, path)), `${path} must exist`).toBe(true);
    }

    expect(read("SECURITY.md")).toContain("Do not open a public issue");
    expect(read("SECURITY.md")).toContain("No public security intake");
    expect(read("SUPPORT.md")).toContain("private controlled beta");
    expect(read("CONTRIBUTING.md")).toContain("pnpm verify:release");
    expect(read("CODE_OF_CONDUCT.md")).toContain("Enforcement");
    expect(read("CHANGELOG.md")).toContain("## [Unreleased]");
    expect(read("CHANGELOG.md")).toContain("No public release has been published");
  });

  it("provides structured bug reports and a release-verification pull request checklist", () => {
    const issueForm = read(".github/ISSUE_TEMPLATE/bug_report.yml");
    const pullRequestTemplate = read(".github/PULL_REQUEST_TEMPLATE.md");

    expect(issueForm).toContain("Local-First RPG bug report");
    expect(issueForm).toContain("Redacted diagnostics");
    expect(issueForm).toContain("Security issue");
    expect(pullRequestTemplate).toContain("pnpm typecheck");
    expect(pullRequestTemplate).toContain("pnpm lint");
    expect(pullRequestTemplate).toContain("pnpm test");
    expect(pullRequestTemplate).toContain("pnpm verify:release");
  });
});

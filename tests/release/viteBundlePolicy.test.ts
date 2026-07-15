import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const config = readFileSync(resolve(process.cwd(), "vite.config.ts"), "utf8");

describe("production bundle policy", () => {
  it("splits schema validation without hiding Vite's default size warning", () => {
    expect(config).toContain('id.includes("node_modules/zod")');
    expect(config).not.toContain("chunkSizeWarningLimit");
  });
});

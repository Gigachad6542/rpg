import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("Rust runtime repository architecture", () => {
  it("keeps snapshot validation in a dedicated module", async () => {
    const repository = await readFile("src-tauri/src/runtime_repository.rs", "utf8");
    const validation = await readFile("src-tauri/src/runtime_repository/validation.rs", "utf8");

    expect(repository).toContain("mod validation;");
    expect(repository).toContain("use validation::{");
    expect(validation).toContain("pub(super) fn sanitize_snapshot");
    expect(validation).toContain("pub(super) fn sanitize_provider_settings");
    expect(validation).toContain("pub(super) fn sanitize_image_provider_settings");
    expect(repository.split(/\r?\n/u).length).toBeLessThan(3_500);
  });

  it("keeps schema evolution in a dedicated module", async () => {
    const repository = await readFile("src-tauri/src/runtime_repository.rs", "utf8");
    const schema = await readFile("src-tauri/src/runtime_repository/schema.rs", "utf8");

    expect(repository).toContain("mod schema;");
    expect(repository).toContain("use schema::{configure_connection, run_migrations};");
    expect(schema).toContain("pub(super) fn run_migrations");
    expect(schema).toContain("const CORE_CONSTRAINT_REBUILDS");
    expect(schema).toContain("fn ensure_database_integrity");
    expect(repository.split(/\r?\n/u).length).toBeLessThan(2_900);
  });
});

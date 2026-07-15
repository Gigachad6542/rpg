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

  it("keeps the Rust repository regression corpus outside production code", async () => {
    const repository = await readFile("src-tauri/src/runtime_repository.rs", "utf8");
    const regressionTests = await readFile("src-tauri/src/runtime_repository/tests.rs", "utf8");

    expect(repository).toContain("#[cfg(test)]\nmod tests;");
    expect(regressionTests).toContain("fn migrations_are_idempotent");
    expect(regressionTests).toContain("fn save_load_round_trip_and_prune_runtime_rows");
    expect(repository.split(/\r?\n/u).length).toBeLessThan(1_800);
  });

  it("keeps normalized snapshot CRUD in a dedicated storage module", async () => {
    const repository = await readFile("src-tauri/src/runtime_repository.rs", "utf8");
    const storage = await readFile("src-tauri/src/runtime_repository/storage.rs", "utf8");

    expect(repository).toContain("mod storage;");
    expect(repository).toContain("use storage::{");
    expect(storage).toContain("pub(super) fn load_runtime_snapshot_at_path");
    expect(storage).toContain("pub(super) fn save_runtime_snapshot_at_path");
    expect(storage).toContain("fn prune_deleted_runtime_rows");
    expect(repository.split(/\r?\n/u).length).toBeLessThan(450);
  });
});

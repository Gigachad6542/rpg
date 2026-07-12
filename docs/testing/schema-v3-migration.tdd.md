# Historical SQLite schema-v3 TDD evidence

## Risk reproduced

The original v1 schema shipped without 19 foreign keys and five CHECK constraints.
Those constraints were later edited into the v1 creation SQL without a version bump;
schema v2 backfilled only seven indexes. The previous upgrade test reused today's
already-constrained v1 constant, so it could not represent an affected installation.

The frozen fixture at `src-tauri/tests/fixtures/schema-v1-0996b8d.sql` is copied from
commit `0996b8d` and intentionally has zero app indexes, foreign keys, or CHECKs.

## RED / GREEN

- RED commit `3024eb0`: the real historical-v1 test failed because migration 3 was
  missing; the v2-but-unconstrained and dirty-data cases were also specified.
- GREEN commit `3f4b808`: schema v3 rebuilds all 11 affected tables and recreates the
  seven indexes.

## Guarantees

- Exact historical v1 and current-risk unconstrained v2 shapes both upgrade.
- All seeded messages, memory, archive payloads, lore, events, knowledge, prompt runs,
  image runs, and RPG state survive with identical row counts.
- Upgraded and fresh databases have equivalent constrained core schemas.
- All 19 foreign-key definitions/actions and five CHECKs are asserted.
- Invalid legacy rows block v3 before mutation; v3 is not recorded and foreign-key
  enforcement is restored.
- A SQLite-consistent pre-v3 backup is retained. A WAL-specific test proves committed
  WAL rows are present in backups.
- Re-running migration is idempotent and does not create another migration backup.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml runtime_repository::tests::`: 18/18
  repository tests passed at the schema checkpoint.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: passed.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`:
  passed.


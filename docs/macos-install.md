# Installing on macOS

Routine CI verifies the frontend tests/build and native Rust tests/clippy on
macOS. A downloadable `.dmg` is produced only when the tag-triggered release
workflow runs, so first confirm that the repository's **Releases** page contains
a macOS artifact. If it does not, there is not yet a published Mac build; use
the local-build instructions below instead.

The current release configuration targets Apple Silicon and requires macOS 11
(Big Sur) or newer. Routine CI does not yet mount and launch the packaged app,
exercise SQLite persistence or Keychain storage, or prove Intel compatibility.

## Download and install

1. Open the repository's **Releases** page on GitHub.
2. Under the latest `v*` release, download
   `Local-First AI RPG Runtime_<version>_aarch64.dmg`.
   Optionally download `SHA256SUMS-macos.txt` to verify the file.
3. Double-click the `.dmg`, then drag **Local-First AI RPG Runtime** into the
   **Applications** folder.

### (Optional) Verify the checksum

```bash
cd ~/Downloads
shasum -a 256 -c SHA256SUMS-macos.txt
```

## First launch (unsigned build)

These builds are **not signed with an Apple Developer ID**, so Gatekeeper will
block the first launch with a message like *"…cannot be opened because the
developer cannot be verified."* This is expected. Bypass it once:

**Option A — Right-click to open (simplest)**

1. In **Applications**, right-click (or Control-click) the app.
2. Choose **Open**.
3. In the dialog, click **Open** again.

macOS remembers this choice; future launches are normal double-clicks.

**Option B — Remove the quarantine flag (terminal)**

If macOS still refuses (newer versions can hide the "Open anyway" button), clear
the quarantine attribute:

```bash
xattr -dr com.apple.quarantine "/Applications/Local-First AI RPG Runtime.app"
```

Then open the app normally.

## Notes

- **API keys** are stored in the macOS **Keychain** (via the `keyring` crate),
  not in plaintext.
- **Local image generation (ComfyUI)** is optional. The Windows dev helper that
  auto-starts ComfyUI does not run on macOS; if you want local image generation,
  start your own ComfyUI server at `http://127.0.0.1:8188` before generating.
- To upgrade, download the newer `.dmg` and drag it over the old app in
  Applications.

## Building locally instead (optional)

If you prefer to build on the Mac rather than download:

```bash
# Prerequisites: Homebrew, then:
brew install node pnpm
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # Rust toolchain

# In the repo:
pnpm install --frozen-lockfile
pnpm verify:version
pnpm desktop:build
```

The `.dmg` is written to `src-tauri/target/release/bundle/dmg/`.

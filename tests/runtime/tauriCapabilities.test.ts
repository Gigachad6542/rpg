import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readdirSync, statSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workspaceRoot = process.cwd();

describe("Tauri secure-storage capabilities", () => {
  it("enforces a single main-window writer for desktop persistence", () => {
    const tauriConfig = JSON.parse(
      readFileSync(join(workspaceRoot, "src-tauri", "tauri.conf.json"), "utf8"),
    ) as { app?: { windows?: Array<{ label?: string }> } };
    const capabilities = JSON.parse(
      readFileSync(join(workspaceRoot, "src-tauri", "capabilities", "default.json"), "utf8"),
    ) as { windows?: string[] };
    const rendererSource = listSourceFiles(join(workspaceRoot, "src"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    const rustSource = listSourceFilesByExtension(join(workspaceRoot, "src-tauri", "src"), /\.rs$/)
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    expect(tauriConfig.app?.windows?.map((window) => window.label)).toEqual(["main"]);
    expect(capabilities.windows).toEqual(["main"]);
    expect(rendererSource).not.toMatch(/WebviewWindow|createWebviewWindow|WindowBuilder/);
    expect(rustSource).not.toMatch(/WebviewWindowBuilder|WindowBuilder/);
  });

  it("registers and grants only the scoped provider-secret commands", () => {
    const buildScript = readFileSync(join(workspaceRoot, "src-tauri", "build.rs"), "utf8");
    const capabilities = JSON.parse(
      readFileSync(join(workspaceRoot, "src-tauri", "capabilities", "default.json"), "utf8"),
    ) as { permissions: string[] };

    for (const command of [
      "secure_storage_status",
      "store_provider_secret",
      "delete_provider_secret",
      "generate_text_with_stored_secret",
      "cancel_text_generation",
      "persist_generated_image",
      "sync_generated_image_files",
      "discover_local_text_providers",
    ]) {
      expect(buildScript).toContain(`"${command}"`);
    }
    expect(buildScript).not.toContain('"get_provider_secret"');

    expect(capabilities.permissions).toEqual(
      expect.arrayContaining([
        "allow-secure-storage-status",
        "allow-store-provider-secret",
        "allow-delete-provider-secret",
        "allow-generate-text-with-stored-secret",
        "allow-cancel-text-generation",
        "allow-persist-generated-image",
        "allow-sync-generated-image-files",
        "allow-discover-local-text-providers",
      ]),
    );
    expect(capabilities.permissions).not.toContain("allow-get-provider-secret");
  });

  it("keeps local provider discovery aligned across renderer, manifest, and capability", () => {
    const rendererDiscovery = readFileSync(
      join(workspaceRoot, "src", "app", "localProviderDiscovery.ts"),
      "utf8",
    );
    const buildScript = readFileSync(join(workspaceRoot, "src-tauri", "build.rs"), "utf8");
    const capabilities = JSON.parse(
      readFileSync(join(workspaceRoot, "src-tauri", "capabilities", "default.json"), "utf8"),
    ) as { permissions: string[] };

    expect(rendererDiscovery).toContain('"discover_local_text_providers"');
    expect(buildScript).toContain('"discover_local_text_providers"');
    expect(capabilities.permissions).toContain("allow-discover-local-text-providers");
  });

  it("does not expose renderer SQL plugin authority", () => {
    const buildScript = readFileSync(join(workspaceRoot, "src-tauri", "build.rs"), "utf8");
    const rustEntry = readFileSync(join(workspaceRoot, "src-tauri", "src", "lib.rs"), "utf8");
    const cargoToml = readFileSync(join(workspaceRoot, "src-tauri", "Cargo.toml"), "utf8");
    const capabilities = JSON.parse(
      readFileSync(join(workspaceRoot, "src-tauri", "capabilities", "default.json"), "utf8"),
    ) as { permissions: string[] };
    const sourceFiles = listSourceFiles(join(workspaceRoot, "src"));

    expect(capabilities.permissions.filter((permission) => permission.startsWith("sql:"))).toEqual([]);
    expect(buildScript).toContain('"initialize_runtime_repository"');
    expect(buildScript).toContain('"load_runtime_snapshot"');
    expect(buildScript).toContain('"save_runtime_snapshot"');
    expect(rustEntry).not.toContain("tauri_plugin_sql");
    expect(cargoToml).not.toContain("tauri-plugin-sql");
    expect(
      sourceFiles.filter((file) => readFileSync(file, "utf8").includes("@tauri-apps/plugin-sql")),
    ).toEqual([]);
  });

  it("keeps production CSP loopback access HTTP-only", () => {
    const tauriConfig = JSON.parse(readFileSync(join(workspaceRoot, "src-tauri", "tauri.conf.json"), "utf8")) as {
      app?: { security?: { csp?: string } };
    };

    const csp = tauriConfig.app?.security?.csp ?? "";
    expect(csp).toContain("connect-src 'self' http://127.0.0.1:* http://localhost:*");
    expect(csp).not.toContain("ws://");
  });
});

function listSourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      return listSourceFiles(path);
    }
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

function listSourceFilesByExtension(root: string, extension: RegExp): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      return listSourceFilesByExtension(path, extension);
    }
    return extension.test(entry) ? [path] : [];
  });
}

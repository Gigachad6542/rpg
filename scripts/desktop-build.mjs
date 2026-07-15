import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const requireSignedRelease = process.env.REQUIRE_SIGNED_RELEASE === "1";
const cli = process.env.npm_execpath
  ? { command: process.execPath, prefix: [process.env.npm_execpath] }
  : { command: process.platform === "win32" ? "pnpm.cmd" : "pnpm", prefix: [] };
const forwardedArgs = process.argv.slice(2).filter((argument) => argument !== "--");
const configuredTarget = process.env.TAURI_BUILD_TARGET?.trim();
if (configuredTarget && !forwardedArgs.includes("--target")) {
  forwardedArgs.push("--target", configuredTarget);
}
const args = [...cli.prefix, "exec", "tauri", "build", ...forwardedArgs];
const releaseBundleRoot = join(
  process.cwd(),
  "src-tauri",
  "target",
  ...(configuredTarget ? [configuredTarget] : []),
  "release",
  "bundle",
);
let temporaryConfig;

if (process.platform === "win32") {
  const thumbprint = process.env.TAURI_WINDOWS_CERTIFICATE_THUMBPRINT?.replace(/\s/g, "").toUpperCase();
  const timestampUrl = process.env.TAURI_WINDOWS_TIMESTAMP_URL?.trim();
  if (requireSignedRelease && (!thumbprint || !timestampUrl)) {
    throw new Error("Signed Windows releases require TAURI_WINDOWS_CERTIFICATE_THUMBPRINT and TAURI_WINDOWS_TIMESTAMP_URL.");
  }
  if (thumbprint || timestampUrl) {
    if (!thumbprint || !/^[A-F0-9]{40,64}$/.test(thumbprint)) {
      throw new Error("TAURI_WINDOWS_CERTIFICATE_THUMBPRINT must be a 40-64 character hexadecimal thumbprint.");
    }
    if (!timestampUrl || !/^https?:\/\//i.test(timestampUrl)) {
      throw new Error("TAURI_WINDOWS_TIMESTAMP_URL must be an HTTP(S) timestamp service.");
    }
    temporaryConfig = join(tmpdir(), `rpg-tauri-signing-${process.pid}.json`);
    writeFileSync(temporaryConfig, JSON.stringify({
      bundle: {
        windows: {
          certificateThumbprint: thumbprint,
          digestAlgorithm: "sha256",
          timestampUrl,
        },
      },
    }), { encoding: "utf8", flag: "wx" });
    args.push("--config", temporaryConfig);
  }
} else if (process.platform === "darwin" && requireSignedRelease) {
  for (const variable of ["APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD", "APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"]) {
    if (!process.env[variable]?.trim()) throw new Error(`Signed and notarized macOS releases require ${variable}.`);
  }
}

try {
  // A release build must not inherit installers from an older product name or
  // version. Downstream signing, checksums, and lifecycle checks can then
  // require exactly one artifact of each expected type.
  rmSync(releaseBundleRoot, { recursive: true, force: true });
  const result = spawnSync(cli.command, args, { cwd: process.cwd(), stdio: "inherit", env: process.env, windowsHide: true });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  if (temporaryConfig) rmSync(temporaryConfig, { force: true });
}

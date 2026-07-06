// Dev entrypoint: ensures a local ComfyUI backend is running before Vite starts.
// ComfyUI must serve the endpoint the app defaults to (http://127.0.0.1:8188)
// with CORS for the dev origin, otherwise browser-mode image generation fails.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const COMFY_PORT = 8188;
const COMFY_ENDPOINT = `http://127.0.0.1:${COMFY_PORT}`;
const DEV_ORIGIN = "http://localhost:5173";
const PROBE_TIMEOUT_MS = 2_500;

async function isComfyRunning() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const response = await fetch(`${COMFY_ENDPOINT}/system_stats`, { signal: controller.signal });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

function findComfyDesktopInstall() {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    return null;
  }
  const comfyDir = join(localAppData, "Comfy-Desktop", "ComfyUI-Installs", "ComfyUI", "ComfyUI");
  const python = join(comfyDir, ".venv", "Scripts", "python.exe");
  if (existsSync(join(comfyDir, "main.py")) && existsSync(python)) {
    return { comfyDir, python };
  }
  return null;
}

async function startComfyIfNeeded() {
  if (await isComfyRunning()) {
    console.log(`[dev] ComfyUI already running at ${COMFY_ENDPOINT}.`);
    return;
  }
  const install = findComfyDesktopInstall();
  if (!install) {
    console.log(
      "[dev] No local ComfyUI install found; image generation stays prompt-only until a ComfyUI server is running.",
    );
    return;
  }
  console.log(`[dev] Starting ComfyUI headless from ${install.comfyDir} on port ${COMFY_PORT}...`);
  const child = spawn(
    install.python,
    ["main.py", "--port", String(COMFY_PORT), "--enable-cors-header", DEV_ORIGIN],
    {
      cwd: install.comfyDir,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  child.unref();
  console.log("[dev] ComfyUI is booting in the background; the app connects once it is ready.");
}

await startComfyIfNeeded();

const vite = spawn(
  process.execPath,
  [join("node_modules", "vite", "bin", "vite.js"), ...process.argv.slice(2)],
  { stdio: "inherit" },
);
vite.on("exit", (code) => {
  process.exit(code ?? 0);
});

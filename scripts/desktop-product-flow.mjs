import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { basename, dirname, join, resolve } from "node:path";

import { chromium } from "@playwright/test";

const DURABLE_MARKER = "PHASE2_DURABLE_MARKER";
const TRANSIENT_MARKER = "PHASE2_TRANSIENT_MARKER";
const DATABASE_FILENAME = "local-first-ai-rpg-runtime.db";
const EVIDENCE_FILENAME = "phase2-windows-product-flow.json";

const options = parseArguments(process.argv.slice(2));
const evidenceRoot = resolve(options.evidence);
const profileRoot = resolve(options.profile);
const runtimeDataRoot = join(profileRoot, "Temp", "RuntimeData");
const databasePath = join(runtimeDataRoot, DATABASE_FILENAME);
const productBackupDirectory = join(dirname(databasePath), "backups");
const backupPath = join(evidenceRoot, "database", "verified-previous-build-backup.db");
const trace = [];
let productBackupSource;

await mkdir(evidenceRoot, { recursive: true });
await mkdir(join(evidenceRoot, "screenshots"), { recursive: true });
await mkdir(join(evidenceRoot, "exports"), { recursive: true });
await mkdir(dirname(backupPath), { recursive: true });
await mkdir(profileRoot, { recursive: true });

await step("previous-build-first-run-provider-create-play-export", async () => {
  await withDesktop(options.previousExe, "previous", async ({ page }) => {
    await completeFirstRunAndProviderSetup(page);
    await createPhase2Card(page);
    await sendAndVerify(page, DURABLE_MARKER);
    await waitForRepositorySave(page);
    await captureRuntimeExport(page, "previous-build-export.json");
    await screenshot(page, "01-previous-build-durable-state.png");
  });
});

if (!existsSync(databasePath)) throw new Error(`Previous packaged build did not create ${databasePath}.`);

await step("current-build-migration-close-reopen-and-mutate", async () => {
  await withDesktop(options.currentExe, "current-migration", async ({ page }) => {
    await openPhase2Card(page);
    await verifyTranscript(page, DURABLE_MARKER, true);
    await sendAndVerify(page, TRANSIENT_MARKER);
    await waitForRepositorySave(page);
    await captureRuntimeExport(page, "current-build-before-restore.json");
    await screenshot(page, "02-current-build-migrated-state.png");
    await page.evaluate(() => globalThis.localStorage.clear());
  });
});

await step("retain-product-generated-startup-backup", async () => {
  const source = await findLatestProductBackup(productBackupDirectory);
  await copyFile(source, backupPath);
  productBackupSource = await describeFile(source);
});

await step("replace-database-with-verified-backup", async () => {
  await rm(`${databasePath}-wal`, { force: true });
  await rm(`${databasePath}-shm`, { force: true });
  await rm(databasePath, { force: true });
  await copyFile(backupPath, databasePath);
});

await step("current-build-restore-verify-and-export", async () => {
  await withDesktop(options.currentExe, "current-restored", async ({ page }) => {
    await openPhase2Card(page);
    await verifyTranscript(page, DURABLE_MARKER, true);
    await verifyTranscript(page, TRANSIENT_MARKER, false);
    const exportPath = await captureRuntimeExport(page, "current-build-restored-export.json");
    const exported = JSON.parse(await readFile(exportPath, "utf8"));
    const serialized = JSON.stringify(exported);
    if (exported.schema !== "rpg.runtime.export" || !serialized.includes(DURABLE_MARKER) || serialized.includes(TRANSIENT_MARKER)) {
      throw new Error("Restored runtime export did not preserve the durable marker and remove the transient marker.");
    }
    await screenshot(page, "03-current-build-restored-state.png");
  });
});

const evidence = {
  schema: "rpg.release.phase2-windows-product-flow",
  version: 1,
  status: "pass",
  createdAt: new Date().toISOString(),
  previousPackage: await describeFile(options.previousMsi),
  currentPackage: await describeFile(options.currentMsi),
  previousExecutable: await describeFile(options.previousExe),
  currentExecutable: await describeFile(options.currentExe),
  productGeneratedBackupSource: productBackupSource,
  restoredDatabase: await describeFile(databasePath),
  retainedBackup: await describeFile(backupPath),
  markers: { durable: DURABLE_MARKER, transientRemoved: TRANSIENT_MARKER },
  steps: trace,
};
await writeFile(join(evidenceRoot, EVIDENCE_FILENAME), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ status: "pass", evidence: join(evidenceRoot, EVIDENCE_FILENAME) })}\n`);

async function withDesktop(executable, label, operation) {
  const port = await reservePort();
  const logPath = join(evidenceRoot, `${label}-app.log`);
  const log = createWriteStream(logPath, { flags: "w" });
  const environment = {
    ...process.env,
    APPDATA: join(profileRoot, "Roaming"),
    LOCALAPPDATA: join(profileRoot, "Local"),
    TEMP: join(profileRoot, "Temp"),
    TMP: join(profileRoot, "Temp"),
    LOCAL_FIRST_AI_RPG_RUNTIME_APP_DATA_DIR: runtimeDataRoot,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  };
  for (const path of [environment.APPDATA, environment.LOCALAPPDATA, environment.TEMP, environment.LOCAL_FIRST_AI_RPG_RUNTIME_APP_DATA_DIR]) {
    await mkdir(path, { recursive: true });
  }

  const child = spawn(resolve(executable), [], {
    cwd: dirname(resolve(executable)),
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });

  let browser;
  try {
    await waitForCdp(port, child);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    if (!context) throw new Error("Packaged WebView2 did not expose a browser context.");
    const page = context.pages()[0] ?? await context.waitForEvent("page", { timeout: 30_000 });
    page.setDefaultTimeout(30_000);
    await page.getByRole("heading", { name: /Open a saved card|Phase 2 Migration RPG/i }).first().waitFor();
    await installDownloadCapture(page);
    await operation({ page, context });
  } catch (error) {
    if (browser) {
      const page = browser.contexts()[0]?.pages()[0];
      if (page) await screenshot(page, `FAIL-${label}.png`).catch(() => undefined);
    }
    throw error;
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (!child.killed && child.exitCode === null) child.kill();
    await Promise.race([
      new Promise((resolveExit) => child.once("exit", resolveExit)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5_000)),
    ]);
    log.end();
  }
}

async function completeFirstRunAndProviderSetup(page) {
  const onboarding = page.getByRole("dialog", { name: /Welcome to your local RPG runtime/i });
  await onboarding.waitFor();
  await onboarding.getByRole("button", { name: /Add API key/i }).click();
  const providerRegion = page.getByRole("region", { name: /LLM API keys/i });
  await providerRegion.getByLabel("Runtime mode").selectOption("mock");
  await providerRegion.getByRole("button", { name: /Store key securely|Activate provider for session/i }).click();
  await providerRegion.getByText("Mock provider active; no API key needed.").waitFor();
}

async function createPhase2Card(page) {
  await page.getByRole("button", { name: /^Cards$/ }).click();
  const create = page.getByRole("region", { name: /Create card/i });
  await create.getByRole("button", { name: /Start creating card/i }).click();
  await create.getByLabel(/^Name$/).fill("Phase 2 Migration RPG");
  await create.getByLabel(/Card type/i).selectOption("rpg");
  await create.getByLabel(/^Summary$/).fill("Packaged release migration and restore proof.");
  await create.getByLabel(/System prompt/i).fill("Preserve packaged release continuity exactly.");
  await create.getByRole("button", { name: /^Create card$/i }).click();
  await page.getByRole("heading", { name: "Phase 2 Migration RPG" }).waitFor();
}

async function openPhase2Card(page) {
  const onboarding = page.getByRole("dialog", { name: /Welcome to your local RPG runtime/i });
  if (await onboarding.isVisible().catch(() => false)) {
    await onboarding.getByRole("button", { name: /Explore on my own/i }).click();
  }
  await page.getByRole("button", { name: /^Cards$/ }).click();
  const card = page.getByRole("region", { name: /Card library/i })
    .locator("article")
    .filter({ hasText: "Phase 2 Migration RPG" });
  await card.getByRole("button", { name: /^Open$/ }).click();
  await page.getByRole("heading", { name: "Phase 2 Migration RPG" }).waitFor();
}

async function sendAndVerify(page, marker) {
  await page.getByLabel(/Message input/i).fill(marker);
  await page.getByRole("button", { name: /^Send$/ }).click();
  await verifyTranscript(page, marker, true);
}

async function verifyTranscript(page, marker, expected) {
  const transcript = page.getByRole("log", { name: /Chat transcript/i });
  if (expected) {
    await transcript.getByText(marker, { exact: true }).waitFor();
  } else if (await transcript.getByText(marker, { exact: true }).count() > 0) {
    throw new Error(`Restored transcript still contains ${marker}.`);
  }
}

async function waitForRepositorySave(page) {
  await page.getByText("Saved to local SQLite repository.", { exact: true }).waitFor({ timeout: 45_000 });
}

async function installDownloadCapture(page) {
  await page.evaluate(() => {
    globalThis.__phase2CapturedDownloads = [];
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      if (blob instanceof Blob) {
        void blob.text().then((text) => globalThis.__phase2CapturedDownloads.push(text));
      }
      return original(blob);
    };
  });
}

async function captureRuntimeExport(page, filename) {
  await page.getByRole("button", { name: /^Settings$/ }).click();
  const before = await page.evaluate(() => globalThis.__phase2CapturedDownloads.length);
  await page.getByRole("button", { name: /Export runtime data/i }).click();
  await page.waitForFunction((count) => globalThis.__phase2CapturedDownloads.length > count, before);
  const raw = await page.evaluate(() => globalThis.__phase2CapturedDownloads.at(-1));
  if (typeof raw !== "string") throw new Error("Runtime export was not captured from the packaged UI.");
  const parsed = JSON.parse(raw);
  if (parsed.schema !== "rpg.runtime.export") throw new Error("Packaged UI export has the wrong schema.");
  const target = join(evidenceRoot, "exports", filename);
  await writeFile(target, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return target;
}

async function screenshot(page, filename) {
  await page.screenshot({ path: join(evidenceRoot, "screenshots", filename), fullPage: true });
}

async function step(name, operation) {
  const startedAt = new Date();
  try {
    await operation();
    trace.push({ name, status: "pass", startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString() });
  } catch (error) {
    trace.push({ name, status: "fail", startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(), error: safeError(error) });
    await writeFile(join(evidenceRoot, EVIDENCE_FILENAME), `${JSON.stringify({ schema: "rpg.release.phase2-windows-product-flow", version: 1, status: "fail", steps: trace }, null, 2)}\n`, "utf8");
    throw error;
  }
}

async function waitForCdp(port, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Packaged desktop process exited before CDP was ready (${child.exitCode}).`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // Retry until the bounded deadline; WebView2 starts asynchronously.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("Packaged WebView2 did not expose CDP within 60 seconds.");
}

async function reservePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

async function describeFile(path) {
  const resolved = resolve(path);
  const bytes = await readFile(resolved);
  const details = await stat(resolved);
  return {
    name: basename(resolved),
    bytes: details.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function findLatestProductBackup(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^runtime-backup-.*\.db$/i.test(entry.name)) continue;
    const path = join(directory, entry.name);
    candidates.push({ path, modifiedAt: (await stat(path)).mtimeMs });
  }
  candidates.sort((left, right) => right.modifiedAt - left.modifiedAt);
  if (!candidates[0]) {
    throw new Error("Current packaged build did not create its rotating SQLite startup backup.");
  }
  return candidates[0].path;
}

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\b(?:sk-|gh[pousr]_)[A-Za-z0-9_-]{8,}\b/gi, "[REDACTED]")
    .slice(0, 500);
}

function parseArguments(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(`Invalid argument near ${name ?? "end of command"}.`);
    }
    result[name.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  for (const required of ["previousExe", "currentExe", "previousMsi", "currentMsi", "profile", "evidence"]) {
    if (!result[required]) throw new Error(`Missing required --${required.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} argument.`);
  }
  return result;
}

import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

const runtimeStorageKey = "local-cards-runtime:v2";

async function openFreshRuntime(page: Page) {
  await page.goto("/");
  return page.getByRole("dialog", { name: /Welcome to Local-First RPG/i });
}

test("first-run mock demo is offline-ready and persists a completed turn", async ({ page }) => {
  const onboarding = await openFreshRuntime(page);
  await expect(onboarding).toBeVisible();
  await onboarding.getByRole("button", { name: /Start mock demo/i }).click();

  await expect(onboarding).toBeHidden();
  await expect(page.getByRole("heading", { name: /Ashfall Crossing/i })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const snapshot = JSON.parse(raw);
        return {
          providerMode: snapshot.providerSettings?.mode,
          onboardingCompleted: snapshot.runtimeSettings?.onboardingCompleted,
        };
      }, runtimeStorageKey),
    )
    .toEqual({ providerMode: "mock", onboardingCompleted: true });

  await page.getByLabel(/Message input/i).fill("I ask Sera what she knows about the missing courier.");
  await page.getByRole("button", { name: /^Send$/ }).click();
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw).promptRuns?.length ?? 0 : 0;
      }, runtimeStorageKey),
    )
    .toBeGreaterThan(0);

  await page.reload();
  await expect(page.getByRole("heading", { name: /Ashfall Crossing/i })).toBeVisible();
  await expect(page.getByRole("log", { name: /Chat transcript/i })).toContainText("missing courier");
});

test("guided card creation survives a full browser reload", async ({ page }) => {
  const onboarding = await openFreshRuntime(page);
  await onboarding.getByRole("button", { name: /Explore on my own/i }).click();
  await page.getByRole("button", { name: /^Cards$/ }).click();

  await page.getByRole("button", { name: /Choice-driven mystery/i }).click();
  const nameInput = page.getByLabel(/^Name$/);
  await expect(nameInput).toHaveValue("New Mystery");
  await nameInput.fill("E2E Mystery");
  await page.getByRole("button", { name: /^Create card$/ }).click();

  await expect(page.getByRole("heading", { name: /^E2E Mystery$/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: /^E2E Mystery$/ })).toBeVisible();

  const savedCard = await page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw).cards?.find((card: { name?: string }) => card.name === "E2E Mystery") : null;
  }, runtimeStorageKey);
  expect(savedCard).toMatchObject({
    name: "E2E Mystery",
    kind: "rpg",
    summary: "A clue-driven mystery where conclusions follow from evidence.",
  });
});

test("runtime export review is reversible and the memory dialog restores keyboard focus", async ({ page }) => {
  const onboarding = await openFreshRuntime(page);
  await onboarding.getByRole("button", { name: /Start mock demo/i }).click();

  const inspectMemory = page.getByRole("button", { name: /Inspect memory/i });
  await inspectMemory.click();
  const memoryDialog = page.getByRole("dialog", { name: /Memory inspector/i });
  const closeMemory = memoryDialog.getByRole("button", { name: /Close memory inspector/i });
  await expect(closeMemory).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closeMemory).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(memoryDialog).toBeHidden();
  await expect(inspectMemory).toBeFocused();

  await page.getByRole("button", { name: /^Settings$/ }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export runtime data/i }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const exportedRuntime = await readFile(downloadPath!, "utf8");

  await page.getByLabel(/Runtime export JSON/i).fill(exportedRuntime);
  await page.getByRole("button", { name: /Review runtime import/i }).click();
  const review = page.getByRole("region", { name: /Runtime import review/i });
  await expect(review).toContainText("This will replace the current runtime");
  await review.getByRole("button", { name: /Cancel import/i }).click();
  await expect(review).toBeHidden();
  await expect(page.getByRole("status", { name: /Data management status/i })).toContainText(
    "current data was not changed",
  );

  await page.getByRole("button", { name: /^Runtime$/ }).click();
  await expect(page.getByRole("heading", { name: /Ashfall Crossing/i })).toBeVisible();
});

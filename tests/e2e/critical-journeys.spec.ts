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

test("main navigation and card editor tabs expose a complete keyboard contract", async ({ page }) => {
  const onboarding = await openFreshRuntime(page);
  await onboarding.getByRole("button", { name: /Start mock demo/i }).click();

  const runtimeNavigation = page.getByRole("button", { name: /^Runtime$/ });
  const cardsNavigation = page.getByRole("button", { name: /^Cards$/ });
  await expect(runtimeNavigation).toHaveAttribute("aria-current", "page");
  await cardsNavigation.focus();
  await page.keyboard.press("Enter");
  await expect(cardsNavigation).toHaveAttribute("aria-current", "page");
  await expect(runtimeNavigation).not.toHaveAttribute("aria-current", "page");

  const tabs = page.getByRole("tablist", { name: /Card editor tabs/i });
  const instructionsTab = tabs.getByRole("tab", { name: /^Instructions$/ });
  const rulesTab = tabs.getByRole("tab", { name: /^Rules$/ });
  await expect(instructionsTab).toHaveAttribute("aria-selected", "true");
  await expect(instructionsTab).toHaveAttribute("tabindex", "0");
  await expect(rulesTab).toHaveAttribute("tabindex", "-1");

  await instructionsTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(rulesTab).toBeFocused();
  await expect(rulesTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: /^Rules$/ })).toBeVisible();

  await page.keyboard.press("End");
  const rpgTab = tabs.getByRole("tab", { name: /^RPG$/ });
  await expect(rpgTab).toBeFocused();
  await expect(rpgTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: /^RPG$/ })).toBeVisible();

  await page.keyboard.press("Home");
  await expect(instructionsTab).toBeFocused();
  await expect(instructionsTab).toHaveAttribute("aria-selected", "true");
});

test("card deletion requires confirmation and offers an explicit recovery path", async ({ page }) => {
  const onboarding = await openFreshRuntime(page);
  await onboarding.getByRole("button", { name: /Explore on my own/i }).click();
  await page.getByRole("button", { name: /^Cards$/ }).click();

  await page.getByRole("button", { name: /Choice-driven mystery/i }).click();
  await page.getByLabel(/^Name$/).fill("Disposable Mystery");
  await page.getByRole("button", { name: /^Create card$/ }).click();
  await page.getByRole("button", { name: /^Cards$/ }).click();

  const card = page.locator("article.card-row", { hasText: "Disposable Mystery" });
  await card.getByRole("button", { name: /^Delete$/ }).click();
  await expect(card.getByRole("button", { name: /Confirm delete Disposable Mystery/i })).toBeVisible();
  await expect(card.getByRole("button", { name: /Cancel delete/i })).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(card.getByRole("button", { name: /^Delete$/ })).toBeVisible();
  await expect(card.getByRole("button", { name: /Cancel delete/i })).toBeHidden();
  await expect(card).toBeVisible();

  await card.getByRole("button", { name: /^Delete$/ }).click();
  await card.getByRole("button", { name: /Confirm delete Disposable Mystery/i }).click();
  await expect(card).toBeHidden();
});

test("chat deletion can be cancelled before the active branch is removed", async ({ page }) => {
  const onboarding = await openFreshRuntime(page);
  await onboarding.getByRole("button", { name: /Start mock demo/i }).click();
  await page.getByRole("button", { name: /^New chat$/ }).click();

  const activeChat = page.getByLabel(/Active chat/i);
  const chatTitle = await activeChat.locator("option:checked").textContent();
  expect(chatTitle).toBeTruthy();

  await page.getByRole("button", { name: /^Delete chat$/ }).click();
  await expect(page.getByRole("button", { name: /Confirm delete chat/i })).toBeVisible();
  const cancel = page.getByRole("button", { name: /Cancel delete chat/i });
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /^Delete chat$/ })).toBeVisible();
  await expect(activeChat.locator("option:checked")).toHaveText(chatTitle!);

  await page.getByRole("button", { name: /^Delete chat$/ }).click();
  await page.getByRole("button", { name: /Confirm delete chat/i }).click();
  await expect(activeChat.locator("option:checked")).not.toHaveText(chatTitle!);
});

test("provider failure is visible and recoverable without reloading the runtime", async ({ page }) => {
  const onboarding = await openFreshRuntime(page);
  await onboarding.getByRole("button", { name: /Start mock demo/i }).click();
  await page.getByRole("button", { name: /API Keys/i }).click();

  const providerPanel = page.getByRole("region", { name: /LLM API keys/i });
  await providerPanel.getByRole("combobox", { name: "Runtime mode", exact: true }).selectOption("openai-compatible");
  await providerPanel.getByRole("combobox", { name: "Provider", exact: true }).selectOption("local");
  await providerPanel.getByLabel(/Base URL/i).fill("http://127.0.0.1:9/v1");
  await providerPanel.getByRole("button", { name: /Test text provider/i }).click();
  await expect(providerPanel).toContainText(/fetch|connect|refused|failed|provider request/i);

  await providerPanel.getByRole("combobox", { name: "Runtime mode", exact: true }).selectOption("mock");
  await providerPanel.getByRole("button", { name: /Test text provider/i }).click();
  await expect(providerPanel).toContainText(/Provider responded through mock/i);
});

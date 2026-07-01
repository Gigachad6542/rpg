import { expect, test } from "@playwright/test";

const runtimeStorageKey = "local-cards-runtime:v2";

test("opens the seeded RPG card, sends a mock turn, and reloads persisted private state", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /Open a saved card/i })).toBeVisible();

  await page.getByRole("button", { name: /^Cards$/ }).click();
  await page.getByRole("region", { name: /Card library/i }).getByRole("button", { name: /^Open$/ }).click();
  await expect(page.getByRole("heading", { name: /Blank Slate RPG/i })).toBeVisible();

  await page.getByLabel(/Message input/i).fill("I inspect the smoke-test room.");
  await page.getByRole("button", { name: /^Send$/ }).click();

  await expect(page.getByRole("log", { name: /Chat transcript/i })).toContainText("smoke-test room");
  await expect
    .poll(async () =>
      page.evaluate((key) => {
        const rawSnapshot = window.localStorage.getItem(key);
        return rawSnapshot ? JSON.parse(rawSnapshot).promptRuns?.length ?? 0 : 0;
      }, runtimeStorageKey),
    )
    .toBeGreaterThan(0);

  const compiledPrompt = await page.evaluate((key) => {
    const rawSnapshot = window.localStorage.getItem(key);
    return rawSnapshot ? JSON.parse(rawSnapshot).promptRuns.at(-1)?.compiledPrompt : undefined;
  }, runtimeStorageKey);
  expect(compiledPrompt).toBe("");

  await page.reload();

  await expect(page.getByRole("heading", { name: /Open a saved card/i })).toBeVisible();
  await page.getByRole("button", { name: /^Cards$/ }).click();
  await page.getByRole("region", { name: /Card library/i }).getByRole("button", { name: /^Open$/ }).click();
  await expect(page.getByRole("heading", { name: /Blank Slate RPG/i })).toBeVisible();
  await expect(page.getByRole("log", { name: /Chat transcript/i })).toContainText("smoke-test room");
});

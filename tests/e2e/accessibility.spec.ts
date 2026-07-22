import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const runtimeStorageKey = "local-cards-runtime:v2";

async function expectNoAutomatedWcagViolations(page: Page, surface: string) {
  await page.evaluate(() => Promise.allSettled(document.getAnimations().map((animation) => animation.finished)));
  const result = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
  const summary = result.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => ({
      target: node.target.join(" "),
      failure: node.failureSummary,
    })),
  }));

  expect(summary, `${surface} contains automated WCAG A/AA violations`).toEqual([]);
}

async function expectNoHorizontalReflowFailures(page: Page, surface: string) {
  const failures = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const documentOverflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - viewportWidth;
    const interactiveOverflow = Array.from(
      document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'),
    )
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      })
      .map((element) => ({
        name: element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 80) ?? element.tagName,
        left: element.getBoundingClientRect().left,
        right: element.getBoundingClientRect().right,
      }))
      .filter(({ left, right }) => left < -1 || right > viewportWidth + 1);

    return { documentOverflow, interactiveOverflow };
  });

  expect(failures, `${surface} must reflow without horizontal document or control overflow`).toEqual({
    documentOverflow: 0,
    interactiveOverflow: [],
  });
}

async function auditMemoryDialog(page: Page, theme: string) {
  const inspectMemory = page.getByRole("button", { name: /Inspect memory/i });
  await inspectMemory.click();
  const dialog = page.getByRole("dialog", { name: /Memory inspector/i });
  await expect(dialog).toBeVisible();
  await expectNoAutomatedWcagViolations(page, `${theme} memory inspector`);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}

async function auditPersonaDeletionDialog(page: Page, theme: string, createPersona: boolean) {
  if (createPersona) {
    await page.getByLabel(/^New persona name$/i).fill("Accessibility persona");
    await page.getByRole("button", { name: /^Create persona$/i }).click();
  }

  const deletePersona = page.getByRole("button", { name: /^Delete Accessibility persona$/i });
  await deletePersona.click();
  const deleteDialog = page.getByRole("alertdialog", { name: /Delete Accessibility persona/i });
  await expectNoAutomatedWcagViolations(page, `${theme} persona deletion dialog`);
  await page.keyboard.press("Escape");
  await expect(deleteDialog).toBeHidden();
}

async function auditSettingsDialogs(page: Page, theme: string) {
  const exportBundle = await page.evaluate((storageKey) => {
    const snapshot = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    return JSON.stringify({
      schema: "rpg.runtime.export",
      version: 1,
      exportedAt: new Date().toISOString(),
      app: { name: "Local-First RPG", exportFormat: "runtime-bundle" },
      snapshot,
    });
  }, runtimeStorageKey);
  await page.getByLabel(/Runtime export JSON/i).fill(exportBundle);
  const reviewImport = page.getByRole("button", { name: /Review runtime import/i });
  await reviewImport.click();
  const importDialog = page.getByRole("alertdialog", { name: /Replace current runtime data/i });
  await expect(importDialog).toBeVisible();
  await expectNoAutomatedWcagViolations(page, `${theme} runtime import dialog`);
  await page.keyboard.press("Escape");
  await expect(importDialog).toBeHidden();

  const restoreRuntime = page.getByRole("button", { name: /^Restore .+/i }).first();
  await restoreRuntime.click();
  const restoreDialog = page.getByRole("alertdialog", { name: /^Restore .+/i });
  await expect(restoreDialog).toBeVisible();
  await expectNoAutomatedWcagViolations(page, `${theme} restore dialog`);
  await page.keyboard.press("Escape");
  await expect(restoreDialog).toBeHidden();
}

test("primary dark and light product surfaces pass automated WCAG A/AA checks", async ({ page }) => {
  await page.goto("/");
  const onboarding = page.getByRole("dialog", { name: /Welcome to Local-First RPG/i });
  await expect(onboarding).toBeVisible();
  await expectNoAutomatedWcagViolations(page, "dark onboarding");

  await onboarding.getByRole("button", { name: /Start mock demo/i }).click();
  await expect(page.getByRole("heading", { name: /Ashfall Crossing/i })).toBeVisible();
  await expectNoAutomatedWcagViolations(page, "dark runtime");
  await auditMemoryDialog(page, "dark");

  for (const section of ["Cards", "Personas", "Lorebooks", "API Keys", "Settings"] as const) {
    await page.getByRole("button", { name: new RegExp(`^${section}$`) }).click();
    await expectNoAutomatedWcagViolations(page, `dark ${section}`);
    if (section === "Personas") {
      await auditPersonaDeletionDialog(page, "dark", true);
    }
  }
  await auditSettingsDialogs(page, "dark");

  await page.getByRole("button", { name: /^Light mode$/i }).click();
  await expectNoAutomatedWcagViolations(page, "light Settings");
  await auditSettingsDialogs(page, "light");

  for (const section of ["Runtime", "Cards", "Personas", "Lorebooks", "API Keys"] as const) {
    await page.getByRole("button", { name: new RegExp(`^${section}$`) }).click();
    await expectNoAutomatedWcagViolations(page, `light ${section}`);
    if (section === "Runtime") {
      await auditMemoryDialog(page, "light");
    } else if (section === "Personas") {
      await auditPersonaDeletionDialog(page, "light", false);
    }
  }
});

test("light first-run onboarding passes automated WCAG A/AA checks", async ({ page }) => {
  await page.goto("/");
  const onboarding = page.getByRole("dialog", { name: /Welcome to Local-First RPG/i });
  await onboarding.getByRole("button", { name: /Start mock demo/i }).click();
  await page.getByRole("button", { name: /^Light mode$/i }).click();
  await expect
    .poll(() =>
      page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey) ?? "null")?.theme, runtimeStorageKey),
    )
    .toBe("light");
  await page.evaluate((storageKey) => {
    const snapshot = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    snapshot.runtimeSettings = { ...snapshot.runtimeSettings, onboardingCompleted: false };
    localStorage.setItem(storageKey, JSON.stringify(snapshot));
  }, runtimeStorageKey);
  await page.reload();
  await expect(onboarding).toBeVisible();
  await expectNoAutomatedWcagViolations(page, "light onboarding");
});

test("primary surfaces reflow at 320 CSS pixels and remain valid in forced colors", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/");
  const onboarding = page.getByRole("dialog", { name: /Welcome to Local-First RPG/i });
  await expectNoHorizontalReflowFailures(page, "onboarding at 320 CSS pixels");
  await onboarding.getByRole("button", { name: /Start mock demo/i }).click();

  for (const section of ["Runtime", "Cards", "Personas", "Lorebooks", "API Keys", "Settings"] as const) {
    await page.getByRole("button", { name: new RegExp(`^${section}$`) }).click();
    await expectNoHorizontalReflowFailures(page, `${section} at 320 CSS pixels`);
  }

  await page.emulateMedia({ forcedColors: "active" });
  await expectNoAutomatedWcagViolations(page, "forced-colors Settings");
  await page.getByRole("button", { name: /^Runtime$/ }).click();
  await expectNoAutomatedWcagViolations(page, "forced-colors runtime");
});

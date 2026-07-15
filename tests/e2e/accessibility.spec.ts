import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoAutomatedWcagViolations(page: Page, surface: string) {
  const result = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
  const summary = result.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => node.target.join(" ")),
  }));

  expect(summary, `${surface} contains automated WCAG A/AA violations`).toEqual([]);
}

test("primary dark and light product surfaces pass automated WCAG A/AA checks", async ({ page }) => {
  await page.goto("/");
  const onboarding = page.getByRole("dialog", { name: /Welcome to Local-First RPG/i });
  await expect(onboarding).toBeVisible();
  await expectNoAutomatedWcagViolations(page, "dark onboarding");

  await onboarding.getByRole("button", { name: /Start mock demo/i }).click();
  await expect(page.getByRole("heading", { name: /Ashfall Crossing/i })).toBeVisible();
  await expectNoAutomatedWcagViolations(page, "dark runtime");

  for (const section of ["Cards", "Lorebooks", "API Keys", "Settings"] as const) {
    await page.getByRole("button", { name: new RegExp(`^${section}$`) }).click();
    await expectNoAutomatedWcagViolations(page, `dark ${section}`);
  }

  await page.getByRole("button", { name: /^Light mode$/i }).click();
  await expectNoAutomatedWcagViolations(page, "light Settings");
  await page.getByRole("button", { name: /^Runtime$/ }).click();
  await expectNoAutomatedWcagViolations(page, "light runtime");
});

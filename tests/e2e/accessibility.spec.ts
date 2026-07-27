import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signIn } from "./support/authors";
import { newDraft } from "./support/studio";

/**
 * An automated accessibility sweep over every page.
 *
 * **Automated checks find perhaps a third of what is wrong**, and it is worth
 * being straight about that rather than treating a green run as a clean bill.
 * What axe is good at is the mechanical half: contrast ratios, missing
 * accessible names, landmarks, form labels, heading order -- exactly the things
 * that are tedious to check by hand and easy to break by accident. The other
 * half is the keyboard journey in `journeys.spec.ts`, which a machine cannot
 * judge.
 *
 * Scoped to WCAG 2.2 A and AA. `best-practice` is deliberately not included:
 * it is opinion rather than a standard, and a suite that fails on opinion gets
 * suppressions added to it until it fails on nothing.
 */

const scan = async (page: Page) =>
  new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

/**
 * Reports the rule, the element and what axe measured, so a failure is
 * actionable without opening a browser.
 *
 * A bare count is the difference between "three violations" and "this link is
 * 3.9:1 against that background", and the second is the one somebody can fix.
 */
async function expectNoViolations(page: Page) {
  const results = await scan(page);

  const oneLine = (text: string) => text.split("\n").join(" ").trim();

  const findings = results.violations.flatMap((violation) =>
    violation.nodes.map(
      (node) =>
        `${violation.id}: ${node.target.join(" ")} -- ${oneLine(node.failureSummary ?? violation.help)}`,
    ),
  );

  expect(findings, "accessibility violations").toEqual([]);
}

test.describe("the public pages", () => {
  const paths = [
    "/",
    "/recipes",
    "/recipes?q=sourdough",
    "/recipes/no-knead-sourdough",
    "/tags",
    "/tags/bread",
    "/signin",
    "/recipes/no-such-recipe-anywhere",
  ];

  for (const path of paths) {
    test(`${path} has no automatically detectable violations`, async ({ page }) => {
      await page.goto(path);
      await expectNoViolations(page);
    });
  }
});

test.describe("the studio", () => {
  test("the dashboard has none", async ({ page }) => {
    await signIn(page);
    await expectNoViolations(page);
  });

  test("the new-recipe form has none", async ({ page }) => {
    await signIn(page);
    await page.goto("/studio/new");
    await expectNoViolations(page);
  });

  test("the editor has none, with both lists populated", async ({ page }) => {
    await signIn(page);
    await newDraft(page, "Axe");

    // Empty lists exercise almost nothing. The rows are where the labels,
    // the move buttons and the live region live.
    await page.getByRole("button", { name: "Add ingredient" }).click();
    await page.getByLabel("Ingredient 1", { exact: true }).fill("flour");
    await page.getByRole("button", { name: "Add step" }).click();
    await page.getByLabel("Step 1", { exact: true }).fill("Mix it.");

    await expectNoViolations(page);
  });
});

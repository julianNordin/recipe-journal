import { expect, test, type Page } from "@playwright/test";

import { newDraft, signIn } from "./support/authors";
import {
  captureAction,
  replayAction,
  reportsASave,
  withField,
  type CapturedAction,
} from "./support/server-action";

/**
 * The boundary where authorization has to happen, and why it is not obvious.
 *
 * Every other spec in this suite drives the application the way a person
 * would. This one does the opposite on purpose: it watches what the browser
 * sends, and then sends it again by hand, as somebody else, to somewhere else.
 * That is not an exotic attack -- it is a POST with a header and a body, and
 * anything that can make an HTTP request can make it.
 *
 * The point being established here is narrow and load-bearing: **a Server
 * Action is a public endpoint.** The guard cannot live on the page that
 * renders the form, because the request does not go through it. It cannot live
 * in `src/proxy.ts` either, and the last test below is the demonstration --
 * the proxy answers an anonymous request aimed at the studio, which reads
 * exactly like a guard until the same request is aimed one path to the left.
 *
 * Ownership -- whether the caller may touch *this* recipe -- is the other half,
 * and it lives in `authorization.spec.ts` next door.
 */

/** A draft of this test's own, and the request its editor sends when saved. */
async function draftAndItsSaveRequest(
  page: Page,
  label: string,
): Promise<{ editUrl: string; captured: CapturedAction }> {
  await signIn(page, "ada");
  const { editUrl } = await newDraft(page, label);

  const captured = await captureAction(page, async () => {
    await page.getByLabel("Summary").fill("written by its author");
    await page.getByRole("button", { name: "Save changes" }).click();
  });
  await expect(page.getByRole("status")).toHaveText("Saved.");

  return { editUrl, captured };
}

/** What was actually stored, read back through the page that renders it. */
async function storedSummary(page: Page, editUrl: string): Promise<string> {
  await page.goto(editUrl);
  return page.getByLabel("Summary").inputValue();
}

test.describe("a Server Action is a public HTTP endpoint", () => {
  test("the request the form sent can be sent again by hand", async ({ page, playwright }) => {
    const { editUrl, captured } = await draftAndItsSaveRequest(page, "Replay");

    // Everything needed is in the open: a URL, one header, and a body.
    expect(captured.actionId).toMatch(/^[0-9a-f]{20,}$/);
    expect(captured.body).toContain("written by its author");

    const result = await replayAction(playwright, captured, {
      as: await page.context().storageState(),
      body: withField(captured.body, "summary", "sent again by hand"),
    });

    /*
     * The positive control, and the reason the refusals below mean anything.
     *
     * Without it, a test that watched a replay fail could not tell "the server
     * refused this" from "the request I rebuilt was malformed" -- and the
     * second is by far the likelier of the two.
     */
    expect(reportsASave(result)).toBe(true);
    expect(await storedSummary(page, editUrl)).toBe("sent again by hand");
  });

  test("and it does not have to be sent back to the page it came from", async ({
    page,
    playwright,
  }) => {
    const { editUrl, captured } = await draftAndItsSaveRequest(page, "Elsewhere");

    /*
     * The same request, posted at the home page.
     *
     * The action id resolves on any route -- the URL in a captured request is
     * where the browser happened to be, not where the action lives. This is
     * the fact the next test rests on, so it is measured here rather than
     * assumed: `/` is not matched by `src/proxy.ts`, and the action ran anyway.
     */
    const result = await replayAction(playwright, captured, {
      as: await page.context().storageState(),
      at: "/",
      body: withField(captured.body, "summary", "posted at the home page"),
    });

    expect(result.location).toBeNull();
    expect(reportsASave(result)).toBe(true);
    expect(await storedSummary(page, editUrl)).toBe("posted at the home page");
  });

  test("an anonymous caller is refused by the action itself", async ({ page, playwright }) => {
    const { editUrl, captured } = await draftAndItsSaveRequest(page, "Anonymous");

    // No cookies, and aimed at `/` so that nothing but the action can be what
    // answers. `requireUser()` is the whole of the refusal.
    const result = await replayAction(playwright, captured, {
      at: "/",
      body: withField(captured.body, "summary", "written by nobody"),
    });

    expect(result.location).toBeNull();
    expect(reportsASave(result)).toBe(false);
    expect(await storedSummary(page, editUrl)).toBe("written by its author");
  });

  test("the proxy redirects the same request aimed at the studio, which is not the same thing", async ({
    page,
    playwright,
  }) => {
    const { editUrl, captured } = await draftAndItsSaveRequest(page, "Proxied");

    // Byte for byte the previous test's request, at the URL the browser used.
    const result = await replayAction(playwright, captured, {
      body: withField(captured.body, "summary", "written by nobody"),
    });

    /*
     * **This is the trap, and it is why the test above aims at `/`.**
     *
     * The proxy matches `/studio/:path*`, so it answers this one with a
     * redirect before the router ever runs -- and a client that followed
     * redirects would see a sign-in page and record it as "refused". It reads
     * exactly like a guard. It is not one: move the same request one path to
     * the left and the proxy is not on it at all. Nothing was refused here;
     * something was redirected, which is a suggestion to a browser.
     *
     * The shape of CVE-2025-29927, which was a header that made this redirect
     * skippable. The version in use is patched. The architecture lesson is not
     * about the patch: it is that a boundary belongs where the work happens.
     */
    expect(result.status).toBe(307);
    expect(result.location).toContain("/signin");

    expect(await storedSummary(page, editUrl)).toBe("written by its author");
  });
});

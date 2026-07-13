import type { PlaywrightWorkerArgs, Page } from "@playwright/test";

import type { SignedInState } from "./authors";

/**
 * Capturing a Server Action's HTTP request, and sending it again.
 *
 * **This module exists to make one claim testable: `"use server"` publishes an
 * HTTP endpoint.** Not "behaves a little like one" -- a POST, to a URL, with a
 * stable id in a header and a body anybody can write. Nothing about calling an
 * action from a form suggests that, which is exactly why the claim is worth
 * demonstrating with a real request rather than asserting in a comment.
 *
 * What was measured while this was written, on Next 16.3.3, and what the
 * helpers below are shaped by:
 *
 * - The request is a `POST` to **the page the browser happened to be on**,
 *   carrying `Next-Action: <id>` and a multipart body. The URL is where the
 *   browser was, not where the action lives.
 * - **The id resolves on any route.** The same request posted to `/`, to
 *   `/recipes` and to `/studio` all ran the action and all wrote. So the URL
 *   is a detail of the capture, not a property of the endpoint -- and a proxy
 *   matching `/studio/:path*` is simply not on the path.
 * - `Next-Router-State-Tree` is not required, and neither is `Origin`:
 *   dropping either still wrote. Next's own same-origin check is a defence
 *   against a *browser* being tricked into sending a request. It has nothing
 *   to say about a request somebody sends on purpose.
 *
 * Redirects are never followed. A proxy redirect and an action's refusal are
 * completely different answers, and a client that follows the first turns it
 * into something that looks like the second.
 */

/** Everything needed to send the request again. All of it visible to the sender. */
export type CapturedAction = {
  /** The `Next-Action` header. Stable for a given build, and not a secret. */
  actionId: string;
  /** Where the browser posted it -- see the note above about what that is worth. */
  url: string;
  /** Carries the multipart boundary, so it travels with the body. */
  contentType: string;
  /** The encoded form, as text. Every field the action will read is in here. */
  body: string;
};

/**
 * Do something that submits a form, and keep the request it produced.
 *
 * The predicate is `Next-Action`, not the URL: a page under test issues plenty
 * of other POSTs, and the header is what makes this one an action call.
 */
export async function captureAction(
  page: Page,
  submit: () => Promise<void>,
): Promise<CapturedAction> {
  const waiting = page.waitForRequest(
    (request) => request.method() === "POST" && request.headers()["next-action"] !== undefined,
  );

  await submit();
  const request = await waiting;

  const headers = await request.allHeaders();
  const actionId = headers["next-action"];
  const contentType = headers["content-type"];
  const body = request.postData();

  if (actionId === undefined || contentType === undefined || body === null) {
    throw new Error("captured a request that does not look like a Server Action call");
  }

  return { actionId, url: request.url(), contentType, body };
}

/** What came back. Read here rather than returned as a live response, so the
 *  request context can be disposed without the caller having to remember. */
export type ReplayResult = {
  status: number;
  /** Set when something redirected rather than answered -- the proxy, usually. */
  location: string | null;
  body: string;
};

/**
 * Send a captured request again, as whoever the caller chooses.
 *
 * `as` is a signed-in browser's cookies, or nothing at all for an anonymous
 * caller. `at` overrides the URL, which is how a test aims a request at a path
 * the proxy does not match. `body` replaces the encoded form -- see
 * `withField`.
 *
 * No cookies are copied from the capture. Everything else is, and only what a
 * sender could produce for themselves: the action id and the content type.
 */
export async function replayAction(
  playwright: PlaywrightWorkerArgs["playwright"],
  captured: CapturedAction,
  options: { as?: SignedInState; at?: string; body?: string } = {},
): Promise<ReplayResult> {
  const origin = new URL(captured.url).origin;

  const context = await playwright.request.newContext({
    baseURL: origin,
    ...(options.as === undefined ? {} : { storageState: options.as }),
  });

  try {
    const response = await context.post(
      options.at === undefined ? captured.url : new URL(options.at, origin).toString(),
      {
        headers: {
          "content-type": captured.contentType,
          "next-action": captured.actionId,
          accept: "text/x-component",
        },
        data: Buffer.from(options.body ?? captured.body, "utf8"),
        // Never followed. See the note at the top of this file.
        maxRedirects: 0,
      },
    );

    return {
      status: response.status(),
      // Lower-cased by Playwright, so this is the whole of the check.
      location: response.headers()["location"] ?? null,
      body: await response.text(),
    };
  } finally {
    await context.dispose();
  }
}

/** True when the action ran and told the form it had saved. */
export const reportsASave = (result: ReplayResult): boolean =>
  result.status === 200 && result.body.includes('"status":"saved"');

/**
 * Replace one field's value in a captured body.
 *
 * The point of a replay is to send *different* content, so the tests need to
 * edit the encoded form. React prefixes the form's own field names when it
 * encodes them (`summary` arrives as `_1_summary`), so the match is on the
 * suffix -- and a name that matches nothing **throws** rather than quietly
 * returning the body unchanged. A helper that silently no-ops here would turn
 * every assertion built on it into a test of nothing, which is the failure
 * mode this project keeps finding the expensive way.
 */
export function withField(body: string, name: string, value: string): string {
  const boundary = body.slice(0, body.indexOf("\r\n"));
  const field = /^\r\nContent-Disposition: form-data; name="([^"]*)"\r\n\r\n([\s\S]*)\r\n$/;

  let found = false;
  const parts = body.split(boundary).map((part) => {
    const match = field.exec(part);
    if (match === null) return part;

    const encodedName = match[1] ?? "";
    if (encodedName !== name && !encodedName.endsWith(`_${name}`)) return part;

    found = true;
    return `\r\nContent-Disposition: form-data; name="${encodedName}"\r\n\r\n${value}\r\n`;
  });

  if (!found) throw new Error(`the captured request has no field named ${name}`);
  return parts.join(boundary);
}

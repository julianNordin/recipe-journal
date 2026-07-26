import { describe, expect, it } from "vitest";

import { escapeXml, renderFeed, type FeedItem } from "./feed";

const AT = new Date("2026-07-15T09:30:00.000Z");

const feed = (items: FeedItem[]) => ({
  title: "Recipe Journal",
  description: "Recipes.",
  siteUrl: "https://example.test",
  feedUrl: "https://example.test/feed.xml",
  items,
  updatedAt: AT,
});

const item = (overrides: Partial<FeedItem> = {}): FeedItem => ({
  title: "No-knead sourdough",
  summary: "A long, slow ferment.",
  url: "https://example.test/recipes/no-knead-sourdough",
  publishedAt: AT,
  ...overrides,
});

describe("escapeXml", () => {
  it("escapes all five reserved characters", () => {
    expect(escapeXml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &apos;");
  });

  it("escapes the ampersand first", () => {
    /*
     * **The order is the bug this function exists not to have.** Escaping `<`
     * before `&` turns `<` into `&lt;` and then the ampersand pass turns that
     * into `&amp;lt;`, so the document renders the literal text `&lt;`. Every
     * escaping helper written in the wrong order passes a test that only ever
     * feeds it one character at a time.
     */
    expect(escapeXml("<")).toBe("&lt;");
    expect(escapeXml("&lt;")).toBe("&amp;lt;");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeXml("Salt and pepper")).toBe("Salt and pepper");
  });
});

describe("renderFeed", () => {
  it("renders a well-formed document with one item", () => {
    const xml = renderFeed(feed([item()]));

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain("<title>No-knead sourdough</title>");
    expect(xml).toContain("<link>https://example.test/recipes/no-knead-sourdough</link>");
    expect(xml).toContain("</rss>");
  });

  it("escapes an ampersand in a title, which is the ordinary case", () => {
    // "Salt & pepper", "Fish & chips". An unescaped ampersand does not degrade
    // a feed -- it makes the whole document unparseable, for every reader.
    const xml = renderFeed(feed([item({ title: "Salt & pepper squid" })]));

    expect(xml).toContain("<title>Salt &amp; pepper squid</title>");
    expect(xml).not.toContain("<title>Salt & pepper");
  });

  it("escapes a summary too", () => {
    const xml = renderFeed(feed([item({ summary: `Uses <1 g of "salt" & no sugar` })]));

    expect(xml).toContain("&lt;1 g of &quot;salt&quot; &amp; no sugar");
  });

  it("omits a description when there is no summary", () => {
    // An empty `<description></description>` is a reader showing a blank line
    // where a sentence belongs.
    const xml = renderFeed(feed([item({ summary: null })]));

    expect(xml).not.toContain("<description></description>");
    expect(xml).toContain("<title>No-knead sourdough</title>");
  });

  it("omits pubDate rather than inventing one", () => {
    const xml = renderFeed(feed([item({ publishedAt: null })]));

    expect(xml).not.toContain("<pubDate>");
  });

  it("dates items in RFC-822, which is what RSS 2.0 asks for", () => {
    const xml = renderFeed(feed([item()]));

    expect(xml).toContain("<pubDate>Wed, 15 Jul 2026 09:30:00 GMT</pubDate>");
  });

  it("renders an empty feed rather than failing on one", () => {
    // A site with nothing published yet still has a feed, and a reader that
    // subscribes to it should get an empty document rather than an error.
    const xml = renderFeed(feed([]));

    expect(xml).toContain("<channel>");
    expect(xml).not.toContain("<item>");
  });

  it("names its own address inside the document", () => {
    const xml = renderFeed(feed([item()]));

    // So a feed that has been copied somewhere else can still be traced back.
    expect(xml).toContain('href="https://example.test/feed.xml" rel="self"');
  });
});

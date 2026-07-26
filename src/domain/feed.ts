/**
 * Rendering an RSS 2.0 feed, as a pure function of its items.
 *
 * **Here rather than in the route handler, because escaping is the whole
 * problem and escaping is testable without a database.** A title containing
 * `&` is the ordinary case -- "Salt & pepper", "Fish & chips" -- not the
 * adversarial one, and an unescaped ampersand does not degrade a feed, it
 * makes it unparseable. Every reader rejects the whole document.
 *
 * So the interesting behaviour lives in a function that takes strings and
 * returns a string, and `src/app/feed.xml/route.ts` is the four lines that
 * fetch and call it.
 *
 * RSS rather than Atom for no better reason than that every reader takes it
 * and it is shorter. Dates are RFC-822, which is what RSS 2.0 specifies --
 * `toUTCString()` produces exactly that format.
 */

export type FeedItem = {
  title: string;
  summary: string | null;
  /** Absolute. A relative link in a feed is read out of context by definition. */
  url: string;
  publishedAt: Date | null;
};

export type Feed = {
  title: string;
  description: string;
  siteUrl: string;
  feedUrl: string;
  items: FeedItem[];
  updatedAt: Date;
};

/**
 * The five characters XML reserves.
 *
 * `&` first, or the escapes escape each other: `<` becomes `&lt;` and then a
 * later pass over `&` turns it into `&amp;lt;`. The order is the bug this
 * function exists to not have.
 */
export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

const element = (name: string, value: string): string => `<${name}>${escapeXml(value)}</${name}>`;

function renderItem(item: FeedItem): string {
  return [
    "    <item>",
    `      ${element("title", item.title)}`,
    `      ${element("link", item.url)}`,
    // The URL is the identifier too. `isPermaLink="true"` says so, which lets a
    // reader that has seen the link recognise the item without a second scheme.
    `      <guid isPermaLink="true">${escapeXml(item.url)}</guid>`,
    item.summary === null ? null : `      ${element("description", item.summary)}`,
    item.publishedAt === null ? null : `      <pubDate>${item.publishedAt.toUTCString()}</pubDate>`,
    "    </item>",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export function renderFeed(feed: Feed): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    ${element("title", feed.title)}`,
    `    ${element("link", feed.siteUrl)}`,
    `    ${element("description", feed.description)}`,
    "    <language>en</language>",
    `    <lastBuildDate>${feed.updatedAt.toUTCString()}</lastBuildDate>`,
    // Where this document lives, said inside the document. A feed that has
    // been copied somewhere else can still be found at its source.
    `    <atom:link href="${escapeXml(feed.feedUrl)}" rel="self" type="application/rss+xml" />`,
    ...feed.items.map(renderItem),
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

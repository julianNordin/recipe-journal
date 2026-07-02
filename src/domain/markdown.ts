/**
 * Recipe bodies are markdown. This turns them into HTML that is safe to put
 * on a page.
 *
 * Pure: no database, no clock, no I/O. Deterministic for a given input.
 *
 * **Why a sanitiser is not optional here.** A body is written by one author
 * and rendered into a page that everybody else loads. An unsanitised pipeline
 * is therefore stored XSS -- the worst-flavoured kind, because it fires for
 * every visitor rather than only for whoever followed a crafted link.
 *
 * There are two defences and they cover different holes:
 *
 *  1. `remark-rehype` does not pass raw HTML through -- `allowDangerousHtml`
 *     is left off, so `<script>` never reaches the output tree at all.
 *  2. `rehype-sanitize` then filters the tree itself, which is what catches
 *     the attacks that need no raw HTML: `[x](javascript:...)` is ordinary
 *     markdown link syntax, and without the sanitiser it renders a live
 *     `javascript:` href.
 *
 * The second is the one that is easy to leave out and hard to notice missing,
 * because every raw-HTML test still passes without it. There is a test named
 * for exactly that.
 *
 * The sanitiser runs on the syntax tree rather than on a string of HTML, so
 * there is no re-parse to disagree with the first parse and no DOM to stand
 * up -- which matters when this runs inside a server render.
 */

import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

/**
 * CommonMark only. GFM is deliberately not enabled: tables, task lists and
 * autolinks all widen the surface the sanitiser has to cover, and a recipe
 * body wants none of them. Adding an extension later means revisiting the
 * schema, not just adding a `.use`.
 */
const processor = unified()
  .use(remarkParse)
  .use(remarkRehype)
  .use(rehypeSanitize)
  .use(rehypeStringify)
  .freeze();

export function renderMarkdown(source: string): string {
  return String(processor.processSync(source));
}

/** The subset of an mdast node this module needs; avoids a types dependency. */
type MarkdownNode = {
  type: string;
  value?: unknown;
  children?: readonly MarkdownNode[];
};

/**
 * Inline node types, which sit *within* a line and must not be padded.
 *
 * The distinction earns its keep: a separator between every node turns
 * `**well**, then` into `well , then`, because the comma is a separate text
 * node that already begins where the bold ended. Only a block boundary is a
 * real gap. Anything unrecognised is treated as a block, which can add a
 * space that was not there but can never run two words together.
 */
const INLINE_NODES = new Set([
  "text",
  "emphasis",
  "strong",
  "inlineCode",
  "link",
  "image",
  "break",
  "delete",
  "linkReference",
  "imageReference",
  "footnoteReference",
]);

/**
 * Prose with the markup taken off -- what a reader actually sees.
 *
 * Used for word counts, where measuring the source would count `**` and URLs
 * as words. Raw HTML is skipped because the renderer drops it: what is counted
 * has to match what is rendered, or an author pasting a block of markup
 * inflates the reading time of a page that never shows it.
 */
export function toPlainText(source: string): string {
  const parts: string[] = [];

  const walk = (node: MarkdownNode): void => {
    if (node.type === "html") return;
    if (!INLINE_NODES.has(node.type)) parts.push("\n");
    if (typeof node.value === "string") parts.push(node.value);
    node.children?.forEach(walk);
  };

  walk(processor.parse(source));

  return parts.join("").replace(/\s+/g, " ").trim();
}

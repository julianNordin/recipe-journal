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
/** The shape of a hast element this transform needs. Not a types dependency. */
type HastNode = { type: string; tagName?: string; children?: HastNode[] };

const HEADINGS: Record<string, string> = { h1: "h2", h2: "h3", h3: "h4", h4: "h5", h5: "h6" };

/**
 * Push every heading in a body down one level, and never past `h6`.
 *
 * **A recipe body is rendered inside the page's `<h1>`, so an author's
 * `# Ingredients` would be a second `<h1>` on the page.** That is not a
 * styling problem: a screen reader's heading list is how somebody navigates a
 * long document, and two top-level headings say the page contains two
 * documents. Markdown has no way to express "a heading, one level down from
 * wherever this ends up", so the shift has to happen here.
 *
 * This was left open in phase 07 with a note to decide it when a page existed,
 * and it is decided here rather than by the automated sweep -- axe's
 * `heading-order` rule would have caught it, and did not, because no seeded
 * body contained a heading. One does now, which is the other half of the fix.
 *
 * `h5` is the last level that moves. Pushing `h6` off the end would delete it,
 * and a heading rendered as a paragraph is worse than one a level too high.
 *
 * Written as a plain recursion rather than pulling in `unist-util-visit`: it
 * is nine lines, and the alternative is depending on a package this project
 * only has transitively.
 */
const shiftHeadings = () => (tree: HastNode) => {
  const walk = (node: HastNode): void => {
    if (node.type === "element" && node.tagName !== undefined) {
      node.tagName = HEADINGS[node.tagName] ?? node.tagName;
    }
    for (const child of node.children ?? []) walk(child);
  };

  walk(tree);
};

const processor = unified()
  .use(remarkParse)
  .use(remarkRehype)
  // Before the sanitiser, so what it checks is what gets rendered. After it,
  // this would be rewriting a tree that had already been approved.
  .use(shiftHeadings)
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

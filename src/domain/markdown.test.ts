import { describe, expect, it } from "vitest";

import { renderMarkdown, toPlainText } from "./markdown";

describe("renderMarkdown", () => {
  it("renders an empty document as nothing", () => {
    expect(renderMarkdown("")).toBe("");
  });

  it("renders headings, emphasis and paragraphs", () => {
    expect(renderMarkdown("## Method\n\nMix **well**, then rest.")).toBe(
      "<h2>Method</h2>\n<p>Mix <strong>well</strong>, then rest.</p>",
    );
  });

  it("renders both kinds of list", () => {
    expect(renderMarkdown("- one\n- two")).toBe("<ul>\n<li>one</li>\n<li>two</li>\n</ul>");
    expect(renderMarkdown("1. first\n2. second")).toBe(
      "<ol>\n<li>first</li>\n<li>second</li>\n</ol>",
    );
  });

  it("renders inline and fenced code, keeping the language class", () => {
    expect(renderMarkdown("`salt`")).toBe("<p><code>salt</code></p>");
    expect(renderMarkdown("```js\nconst x = 1;\n```")).toBe(
      '<pre><code class="language-js">const x = 1;\n</code></pre>',
    );
  });

  it("renders blockquotes and rules", () => {
    expect(renderMarkdown("> rest it")).toBe("<blockquote>\n<p>rest it</p>\n</blockquote>");
    expect(renderMarkdown("---")).toBe("<hr>");
  });

  it("escapes text that looks like markup", () => {
    expect(renderMarkdown("5 < 6 & rising")).toBe("<p>5 &#x3C; 6 &#x26; rising</p>");
  });

  it("is deterministic", () => {
    const source = "# Title\n\nSome *body* with [a link](https://example.test).";
    expect(renderMarkdown(source)).toBe(renderMarkdown(source));
  });

  it("does not enable GFM tables", () => {
    // A deliberate omission, asserted so a future reader knows it is a
    // decision and not a bug: every extension widens the surface the
    // sanitiser has to cover, and a recipe body has no use for a table.
    expect(renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |")).not.toContain("<table>");
  });
});

describe("renderMarkdown: link safety", () => {
  it("keeps an ordinary link intact", () => {
    // The control. Without it, a sanitiser that stripped every href would
    // pass every test below while breaking the feature.
    expect(renderMarkdown("[source](https://example.test/x)")).toBe(
      '<p><a href="https://example.test/x">source</a></p>',
    );
  });

  it("keeps a relative link intact", () => {
    expect(renderMarkdown("[another](/recipes/sourdough)")).toBe(
      '<p><a href="/recipes/sourdough">another</a></p>',
    );
  });

  it("keeps an ordinary image intact", () => {
    expect(renderMarkdown("![crumb](https://example.test/a.png)")).toBe(
      '<p><img src="https://example.test/a.png" alt="crumb"></p>',
    );
  });

  it("drops a javascript: href but keeps the link text", () => {
    // THE test that proves the sanitiser is wired in.
    //
    // Every raw-HTML payload below is dropped by remark-rehype before the
    // sanitiser ever runs, because raw HTML is not passed through unless
    // `allowDangerousHtml` is set. So a suite that only tried <script> tags
    // would stay green with the sanitiser deleted -- and this line would be
    // a live stored-XSS hole reached through pure markdown syntax, no raw
    // HTML required.
    //
    // Measured, by deleting the `.use(rehypeSanitize)` and running the file:
    // 9 of 45 failed, and every one of the 9 was a URL-scheme case. All four
    // raw-HTML tests and all twelve raw-HTML payloads in the sweep stayed
    // green. Those tests are worth keeping, but not one of them can tell you
    // the sanitiser is there.
    expect(renderMarkdown("[click](javascript:alert(1))")).toBe("<p><a>click</a></p>");
  });

  it("drops a javascript: href whatever its casing", () => {
    expect(renderMarkdown("[click](JaVaScRiPt:alert(1))")).toBe("<p><a>click</a></p>");
  });

  it("drops a data: href", () => {
    expect(renderMarkdown("[click](data:text/html;base64,PHNjcmlwdD4=)")).toBe(
      "<p><a>click</a></p>",
    );
  });

  it("drops a javascript: image source", () => {
    expect(renderMarkdown("![alt](javascript:alert(1))")).toBe('<p><img alt="alt"></p>');
  });
});

describe("renderMarkdown: raw HTML", () => {
  it("drops a script element entirely", () => {
    expect(renderMarkdown("<script>alert(1)</script>")).toBe("");
  });

  it("drops an element carrying an event handler", () => {
    expect(renderMarkdown("<img src=x onerror=alert(1)>")).toBe("");
  });

  it("drops an iframe", () => {
    expect(renderMarkdown("<iframe src=https://evil.test></iframe>")).toBe("");
  });

  it("drops the tags of a handcrafted anchor but keeps its text", () => {
    expect(renderMarkdown('<a href="https://ok.test" onclick="steal()">label</a>')).toBe(
      "<p>label</p>",
    );
  });
});

describe("renderMarkdown: the payload sweep", () => {
  const PAYLOADS = [
    "[a](javascript:alert(1))",
    "[a](JAVASCRIPT:alert(1))",
    "[a](  javascript:alert(1)  )",
    "[a](vbscript:msgbox(1))",
    "[a](data:text/html;base64,PHN2Zy9vbmxvYWQ9YWxlcnQoMSk+)",
    "![a](javascript:alert(1))",
    "<script>alert(1)</script>",
    "<script src=https://evil.test/x.js></script>",
    "<img src=x onerror=alert(1)>",
    "<svg onload=alert(1)></svg>",
    "<iframe src=javascript:alert(1)></iframe>",
    "<body onload=alert(1)>",
    "<details open ontoggle=alert(1)></details>",
    '<a href="#" onclick="alert(1)">x</a>',
    "<style>body{background:url(javascript:alert(1))}</style>",
    "<object data=javascript:alert(1)></object>",
    "<form action=javascript:alert(1)><button>go</button></form>",
    "<math><mtext><script>alert(1)</script></mtext></math>",
  ];

  // Recipe bodies are author-supplied and rendered straight into a page that
  // other people load, so any one of these getting through is stored XSS
  // rather than a formatting glitch. Asserting the property over the whole
  // battery beats asserting exact markup case by case: a future change to the
  // pipeline has to keep all of it true, not just the examples someone
  // remembered to update.
  it.each(PAYLOADS)("neutralises %j", (payload) => {
    const html = renderMarkdown(payload);
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toMatch(/vbscript:/i);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<iframe/i);
    expect(html).not.toMatch(/\son\w+\s*=/i);
  });
});

describe("toPlainText", () => {
  it("is empty for an empty document", () => {
    expect(toPlainText("")).toBe("");
  });

  it("strips the markup and keeps the prose", () => {
    expect(toPlainText("## Method\n\nMix **well**, then *rest*.")).toBe(
      "Method Mix well, then rest.",
    );
  });

  it("separates blocks with a space rather than running them together", () => {
    expect(toPlainText("# Title\n\nBody")).toBe("Title Body");
  });

  it("collapses the whitespace markdown leaves behind", () => {
    expect(toPlainText("a  **b**   c")).toBe("a b c");
  });

  it("keeps code, which the reader still sees", () => {
    expect(toPlainText("use `salt`")).toBe("use salt");
    expect(toPlainText("```\nknead well\n```")).toBe("knead well");
  });

  it("skips raw HTML, which the reader never sees", () => {
    // What is counted has to match what is rendered, and the renderer drops
    // raw HTML -- so counting it would overstate the reading time by whatever
    // an author pasted in.
    expect(toPlainText("<div>hidden</div>\n\nvisible")).toBe("visible");
  });

  it("takes link text but not link targets", () => {
    expect(toPlainText("see [the source](https://example.test/x)")).toBe("see the source");
  });

  it("is deterministic", () => {
    expect(toPlainText("# A\n\nb")).toBe(toPlainText("# A\n\nb"));
  });
});

import { describe, expect, it } from "vitest";

import { WORDS_PER_MINUTE, readingTime } from "./reading-time";

const words = (n: number): string => Array.from({ length: n }, () => "word").join(" ");

describe("readingTime", () => {
  it("reports nothing for an empty body", () => {
    // Not one minute. There is nothing to read, and "1 min read" over a blank
    // page is a worse answer than no badge at all -- which is what a caller
    // can now decide to show, because zero is distinguishable.
    expect(readingTime("")).toEqual({ words: 0, minutes: 0 });
    expect(readingTime("   \n\n  ")).toEqual({ words: 0, minutes: 0 });
  });

  it("rounds a short body up to one minute", () => {
    expect(readingTime("Salt the water.")).toEqual({ words: 3, minutes: 1 });
  });

  it("reads exactly one minute at the rate", () => {
    expect(readingTime(words(WORDS_PER_MINUTE))).toEqual({
      words: WORDS_PER_MINUTE,
      minutes: 1,
    });
  });

  it("rounds up rather than down", () => {
    // One word over the line is still a second minute of reading.
    expect(readingTime(words(WORDS_PER_MINUTE + 1)).minutes).toBe(2);
  });

  it("scales linearly", () => {
    expect(readingTime(words(WORDS_PER_MINUTE * 4)).minutes).toBe(4);
  });

  it("counts words, not markup", () => {
    expect(readingTime("**bold** and *italic*").words).toBe(3);
    expect(readingTime("## A heading\n\n- one\n- two").words).toBe(4);
  });

  it("does not count a link target as reading", () => {
    // A long URL is one hyphen-riddled token that nobody reads. Counting the
    // source rather than the rendered text would let a single link add a
    // minute to the estimate.
    expect(readingTime("see [the source](https://example.test/a/very/long/path)").words).toBe(3);
  });

  it("does not count raw HTML, which never renders", () => {
    expect(readingTime("<div>one two three four five</div>\n\nvisible").words).toBe(1);
  });

  it("counts a hyphenated word once", () => {
    expect(readingTime("slow-roasted tomatoes").words).toBe(2);
  });

  it("is deterministic and reads no clock", () => {
    const body = "# Title\n\nSome body text.";
    expect(readingTime(body)).toEqual(readingTime(body));
  });
});

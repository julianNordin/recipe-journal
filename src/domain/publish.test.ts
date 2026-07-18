import { describe, expect, it } from "vitest";

import {
  isPubliclyVisible,
  publish,
  publishProblems,
  unpublish,
  type PublishableRecipe,
} from "./publish";

const NOW = new Date("2026-07-10T09:00:00.000Z");
const EARLIER = new Date("2026-06-24T07:40:00.000Z");

function complete(overrides: Partial<PublishableRecipe> = {}): PublishableRecipe {
  return {
    status: "DRAFT",
    title: "No-knead sourdough",
    summary: "A long, slow ferment.",
    body: "Start it the night before.",
    publishedAt: null,
    ingredientCount: 4,
    stepCount: 5,
    ...overrides,
  };
}

describe("publishProblems", () => {
  it("finds nothing wrong with a complete recipe", () => {
    expect(publishProblems(complete())).toEqual([]);
  });

  it.each([
    ["missing-title", { title: "" }],
    ["missing-summary", { summary: null }],
    ["missing-body", { body: "" }],
    ["no-ingredients", { ingredientCount: 0 }],
    ["no-steps", { stepCount: 0 }],
  ] as const)("reports %s", (problem, overrides) => {
    expect(publishProblems(complete(overrides))).toContain(problem);
  });

  it("treats whitespace as absent", () => {
    expect(publishProblems(complete({ summary: "   " }))).toContain("missing-summary");
    expect(publishProblems(complete({ title: "\n\t " }))).toContain("missing-title");
  });

  it("reports every problem at once rather than the first", () => {
    const problems = publishProblems(
      complete({ title: "", summary: null, body: "", ingredientCount: 0, stepCount: 0 }),
    );
    // Otherwise the author fixes one omission, saves, and is told about the
    // next -- five round trips for five mistakes.
    expect(problems).toHaveLength(5);
  });
});

describe("publish", () => {
  it("refuses an incomplete recipe and says why", () => {
    const outcome = publish(complete({ stepCount: 0 }), NOW);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.problems).toEqual(["no-steps"]);
  });

  it("stamps the current time on a first publish", () => {
    const outcome = publish(complete(), NOW);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.status).toBe("PUBLISHED");
      expect(outcome.publishedAt).toEqual(NOW);
    }
  });

  it("keeps the original date on a re-publish", () => {
    // The point of the whole design: unpublishing to fix a typo and
    // republishing must not reorder the archive.
    const outcome = publish(complete({ publishedAt: EARLIER }), NOW);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.publishedAt).toEqual(EARLIER);
  });

  it("survives a full publish, unpublish, republish cycle unchanged", () => {
    const first = publish(complete(), EARLIER);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const drafted = unpublish(complete({ status: "PUBLISHED", publishedAt: first.publishedAt }));
    expect(drafted.status).toBe("DRAFT");
    expect(drafted.publishedAt).toEqual(EARLIER);

    const second = publish(complete({ status: "DRAFT", publishedAt: drafted.publishedAt }), NOW);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.publishedAt).toEqual(EARLIER);
  });

  it("takes now as an argument rather than reading the clock", () => {
    const a = publish(complete(), new Date("2026-07-01T00:00:00.000Z"));
    const b = publish(complete(), new Date("2026-07-02T00:00:00.000Z"));
    expect(a.ok && b.ok && a.publishedAt).not.toEqual(b.ok && b.publishedAt);
  });
});

describe("unpublish", () => {
  it("returns to draft while keeping the date", () => {
    const result = unpublish(complete({ status: "PUBLISHED", publishedAt: EARLIER }));
    expect(result).toEqual({ status: "DRAFT", publishedAt: EARLIER });
  });

  it("leaves a never-published recipe with no date", () => {
    expect(unpublish(complete())).toEqual({ status: "DRAFT", publishedAt: null });
  });
});

describe("isPubliclyVisible", () => {
  it("is true only for a published recipe", () => {
    expect(isPubliclyVisible({ status: "PUBLISHED" })).toBe(true);
    expect(isPubliclyVisible({ status: "DRAFT" })).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, pageCount, resolvePaging } from "./paging";

describe("resolvePaging", () => {
  it("defaults to the first page", () => {
    expect(resolvePaging()).toEqual({
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      skip: 0,
      take: DEFAULT_PAGE_SIZE,
    });
  });

  it("reads a page number and turns it into an offset", () => {
    expect(resolvePaging({ page: "3", pageSize: "10" })).toEqual({
      page: 3,
      pageSize: 10,
      skip: 20,
      take: 10,
    });
  });

  it("clamps an absurd page size instead of running the query", () => {
    // The whole point of doing this before the query rather than after: a
    // caller asking for a hundred thousand rows should not get a hundred
    // thousand rows, and should not get an error either.
    expect(resolvePaging({ pageSize: "100000" }).pageSize).toBe(MAX_PAGE_SIZE);
    expect(resolvePaging({ pageSize: "100000" }).take).toBe(MAX_PAGE_SIZE);
  });

  it.each([
    ["not a number", "abc"],
    ["empty", ""],
    ["zero", "0"],
    ["negative", "-5"],
    ["fractional", "2.7"],
    ["exponent notation", "1e99"],
    ["whitespace", "   "],
    ["infinity", "Infinity"],
    ["a number with junk", "3px"],
  ])("falls back to page 1 on a %s page", (_label, page) => {
    expect(resolvePaging({ page }).page).toBe(1);
    expect(resolvePaging({ page }).skip).toBe(0);
  });

  it.each([
    ["not a number", "abc"],
    ["zero", "0"],
    ["negative", "-20"],
    ["fractional", "12.5"],
  ])("falls back to the default page size on a %s size", (_label, pageSize) => {
    expect(resolvePaging({ pageSize }).pageSize).toBe(DEFAULT_PAGE_SIZE);
  });

  it("takes the first value when a parameter is repeated", () => {
    // `?page=2&page=9` arrives as an array. Taking the first is forgiving
    // rather than clever; rejecting it would 400 on a URL a user can produce
    // by double-clicking a pager link.
    expect(resolvePaging({ page: ["2", "9"] }).page).toBe(2);
    expect(resolvePaging({ page: [] }).page).toBe(1);
  });

  it("accepts a page size at the boundaries", () => {
    expect(resolvePaging({ pageSize: "1" }).pageSize).toBe(1);
    expect(resolvePaging({ pageSize: String(MAX_PAGE_SIZE) }).pageSize).toBe(MAX_PAGE_SIZE);
  });

  it("never produces a negative offset", () => {
    // skip goes straight into a SQL OFFSET, where a negative is an error
    // rather than a smaller result.
    for (const page of ["-1", "-100", "0", "abc", undefined]) {
      expect(resolvePaging({ page }).skip).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps a large but legitimate page number", () => {
    // Deep paging is allowed; it just finds nothing. Clamping the page here
    // would need a total this function does not have.
    expect(resolvePaging({ page: "500", pageSize: "10" })).toMatchObject({ page: 500, skip: 4990 });
  });
});

describe("pageCount", () => {
  it("is zero when there is nothing to page", () => {
    // Zero rather than one, so a caller can tell "no results" from "one page
    // of results" and hide the pager without inspecting the item count too.
    expect(pageCount(0, 10)).toBe(0);
  });

  it("rounds a partial last page up", () => {
    expect(pageCount(1, 10)).toBe(1);
    expect(pageCount(10, 10)).toBe(1);
    expect(pageCount(11, 10)).toBe(2);
    expect(pageCount(20, 10)).toBe(2);
    expect(pageCount(21, 10)).toBe(3);
  });
});

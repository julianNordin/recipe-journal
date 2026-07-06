/**
 * Turning untrusted query-string values into an offset and a limit.
 *
 * Pure, and in the domain layer rather than beside a page, because more than
 * one surface needs the same answer: the list pages read `searchParams`, and
 * phase 18's `/api/recipes` route handler reads a real query string. Two
 * implementations would drift, and the one that drifted would be the one
 * without a clamp.
 *
 * Everything here treats its input as hostile. `searchParams` values are
 * `string | string[] | undefined` and a person can type anything into a URL,
 * so every value is parsed rather than trusted, and nothing throws -- a
 * nonsense page number is page one, not a 500.
 */

export const DEFAULT_PAGE_SIZE = 12;

/**
 * The ceiling exists so a URL cannot ask the database for the whole table.
 * Fifty is generous for a page of recipe cards and small enough that the query
 * stays cheap however it is called.
 */
export const MAX_PAGE_SIZE = 50;

export type PagingInput = {
  page?: string | string[] | undefined;
  pageSize?: string | string[] | undefined;
};

export type Paging = {
  /** 1-based, as it appears in the URL. */
  page: number;
  pageSize: number;
  /** SQL OFFSET. Never negative. */
  skip: number;
  /** SQL LIMIT. Never above MAX_PAGE_SIZE. */
  take: number;
};

/** `?page=2&page=9` arrives as an array; the first value wins. */
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * A positive integer, or undefined.
 *
 * `Number()` alone is too permissive here: it reads "" as 0, " " as 0 and
 * "1e99" as a finite number far outside anything a database should be asked
 * for. Matching the digits first rejects all three, along with "2.7" and
 * "3px", without a special case for each.
 */
function positiveInteger(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return undefined;
  const value = Number(raw.trim());
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function resolvePaging(input: PagingInput = {}): Paging {
  const page = positiveInteger(firstValue(input.page)) ?? 1;

  const requested = positiveInteger(firstValue(input.pageSize));
  const pageSize = requested === undefined ? DEFAULT_PAGE_SIZE : Math.min(requested, MAX_PAGE_SIZE);

  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

/**
 * Zero when there is nothing, rather than one.
 *
 * It lets a caller hide the pager on `pageCount <= 1` without also having to
 * ask whether the list was empty.
 */
export function pageCount(total: number, pageSize: number): number {
  if (total <= 0 || pageSize <= 0) return 0;
  return Math.ceil(total / pageSize);
}

import Link from "next/link";

import styles from "./Pager.module.css";

/**
 * Previous/next paging, as links.
 *
 * A server component with no state and no JavaScript. Paging is navigation, so
 * each page is a real URL: it can be bookmarked, opened in a new tab, shared,
 * and reached by a search engine. A pair of buttons calling `router.push`
 * would look identical and lose all of that.
 *
 * Renders nothing at all when there is one page or none, so a caller can drop
 * it in unconditionally.
 */
export function Pager({
  page,
  pageCount,
  basePath,
  searchParams,
}: {
  page: number;
  pageCount: number;
  basePath: string;
  /** Any other query parameters to carry across, e.g. a page size. */
  searchParams?: Record<string, string | undefined>;
}) {
  if (pageCount <= 1) return null;

  const href = (target: number): string => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams ?? {})) {
      if (value !== undefined) params.set(key, value);
    }
    // Page one is the bare path. Two URLs for the same page is a duplicate
    // the sitemap and the crawler would both have to reconcile.
    if (target > 1) params.set("page", String(target));
    const query = params.toString();
    return query === "" ? basePath : `${basePath}?${query}`;
  };

  const hasPrevious = page > 1;
  const hasNext = page < pageCount;

  return (
    <nav className={styles.pager} aria-label="Pagination">
      {hasPrevious ? (
        <Link href={href(page - 1)} className={styles.step} rel="prev">
          <span aria-hidden="true">←</span> Previous
        </Link>
      ) : (
        // A disabled-looking span rather than a link to nowhere. An anchor
        // with no href is not focusable and is announced as plain text
        // anyway, so it may as well say what it is.
        <span className={styles.disabled}>
          <span aria-hidden="true">←</span> Previous
        </span>
      )}

      <p className={styles.position} aria-current="page">
        Page {page} of {pageCount}
      </p>

      {hasNext ? (
        <Link href={href(page + 1)} className={styles.step} rel="next">
          Next <span aria-hidden="true">→</span>
        </Link>
      ) : (
        <span className={styles.disabled}>
          Next <span aria-hidden="true">→</span>
        </span>
      )}
    </nav>
  );
}

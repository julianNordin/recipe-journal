import { describe, expect, it } from "vitest";

import { formatDay, formatLongDay } from "./format-date";

describe("formatDay", () => {
  it("renders a day, a short month and a year", () => {
    expect(formatDay(new Date("2026-07-14T10:30:00.000Z"))).toBe("14 Jul 2026");
  });

  it("does not pad the day", () => {
    expect(formatDay(new Date("2026-07-02T10:30:00.000Z"))).toBe("2 Jul 2026");
  });

  it("reads the date in UTC, not in whoever is looking", () => {
    /*
     * **The reason this function exists rather than three call sites.** A
     * server renders in one time zone and a browser in another, so an instant
     * late enough in the day lands on different dates in each -- and React
     * reports that as a hydration mismatch, on a page whose whole claim is
     * that the server rendered it.
     *
     * 23:30 UTC is the next day in Stockholm and the same day here, always.
     */
    expect(formatDay(new Date("2026-07-14T23:30:00.000Z"))).toBe("14 Jul 2026");
    expect(formatDay(new Date("2026-07-14T00:30:00.000Z"))).toBe("14 Jul 2026");
  });

  it("does not roll over at the end of a month", () => {
    // The last millisecond of June, in UTC. Anywhere ahead of UTC this instant
    // is already July, which is exactly what the fixed zone prevents.
    expect(formatDay(new Date("2026-06-30T23:59:59.999Z"))).toBe("30 Jun 2026");
  });
});

describe("formatLongDay", () => {
  it("spells the month out", () => {
    expect(formatLongDay(new Date("2026-07-14T10:30:00.000Z"))).toBe("14 July 2026");
  });

  it("reads the date in UTC too", () => {
    // The pair share the zone. A page that used one and a card that used the
    // other must not be able to disagree about which day it is.
    expect(formatLongDay(new Date("2026-07-14T23:30:00.000Z"))).toBe("14 July 2026");
  });
});

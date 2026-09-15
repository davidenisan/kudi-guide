import { env } from "../config/env.js";
import type { DateRange } from "./types.js";

/**
 * Calendar boundaries in the user's timezone.
 *
 * "Same day" (dedup) and "this month" (summaries) mean the Nigerian calendar
 * day/month, not the server's. Deriving these from the host's local time would
 * silently produce different answers on a laptop and on a UTC server, so the
 * zone is always explicit and defaults to SUMMARY_TIMEZONE.
 */

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** The wall-clock time an instant shows in a zone. */
function wallClockIn(instant: Date, timeZone: string): WallClock {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    // Some engines render midnight as hour 24 under hour12: false.
    hour: read("hour") % 24,
    minute: read("minute"),
    second: read("second"),
  };
}

/** The zone's UTC offset in milliseconds at a given instant. */
function offsetMsAt(instant: Date, timeZone: string): number {
  const wall = wallClockIn(instant, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  // formatToParts drops sub-second precision; ignore it rather than let it skew the offset.
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant at which a zone's wall clock reads the given local time. */
function instantOfWallClock(wall: WallClock, timeZone: string): Date {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  // Two passes so the offset is evaluated at (approximately) the right instant,
  // which matters near a DST transition. Africa/Lagos has none, but the helper
  // should not quietly depend on that.
  let instant = naive - offsetMsAt(new Date(naive), timeZone);
  instant = naive - offsetMsAt(new Date(instant), timeZone);
  return new Date(instant);
}

/** Midnight-to-midnight around `instant`, in `timeZone`. `to` is exclusive. */
export function dayRange(instant: Date, timeZone: string = env.SUMMARY_TIMEZONE): DateRange {
  const wall = wallClockIn(instant, timeZone);
  const from = instantOfWallClock({ ...wall, hour: 0, minute: 0, second: 0 }, timeZone);
  const to = instantOfWallClock(
    { ...wall, day: wall.day + 1, hour: 0, minute: 0, second: 0 },
    timeZone,
  );
  return { from, to };
}

/** The whole calendar month containing `instant`, in `timeZone`. `to` is exclusive. */
export function monthRange(instant: Date, timeZone: string = env.SUMMARY_TIMEZONE): DateRange {
  const wall = wallClockIn(instant, timeZone);
  const from = instantOfWallClock(
    { ...wall, day: 1, hour: 0, minute: 0, second: 0 },
    timeZone,
  );
  const to = instantOfWallClock(
    { ...wall, month: wall.month + 1, day: 1, hour: 0, minute: 0, second: 0 },
    timeZone,
  );
  return { from, to };
}

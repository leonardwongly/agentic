// Deterministic date formatting shared across server and client renders.
//
// Using a fixed locale ("en-US") and timeZone ("UTC") guarantees that the
// string produced during server-side rendering matches the string produced on
// the client during hydration. Bare `toLocale*` calls inherit the host locale
// and timezone, which differ between the server and the browser and cause React
// hydration mismatches (the rendered subtree is then thrown away and
// regenerated on the client).
//
// Accepted input is an ISO 8601 calendar date (optionally with a time and zone), an epoch
// millisecond number, or a Date. Anything else - unparseable text, a bare epoch-ms string,
// or an impossible date such as "2026-02-30" that a lenient parser would roll over - renders
// "" so callers can hide the field instead of showing a guessed date.
const DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric"
});

const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

const TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  hour: "2-digit",
  minute: "2-digit"
});

// ISO calendar date with an optional time and explicit zone. Anything else ("not-a-date",
// a bare epoch-ms string, RFC 2822 text) is refused instead of being guessed at.
const ISO_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})?)?$/u;

const MAX_TIMESTAMP_MS = 8.64e15;

function toDate(input: string | number | Date | null | undefined): Date | null {
  // A nullable timestamp must render as "" like `undefined` does; `new Date(null)` would
  // otherwise silently become the unix epoch ("Jan 1, 1970").
  if (input === null || input === undefined) {
    return null;
  }

  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }

  if (typeof input === "number") {
    if (!Number.isFinite(input) || Math.abs(input) > MAX_TIMESTAMP_MS) {
      return null;
    }

    const fromNumber = new Date(input);

    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }

  const match = ISO_DATE_TIME_PATTERN.exec(input.trim());

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // `new Date("2026-02-30")` rolls an impossible calendar date over into a neighbouring real
  // date (Mar 2) instead of failing, so the calendar fields must round-trip before we format.
  const calendar = new Date(Date.UTC(year, month - 1, day));

  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) {
    return null;
  }

  // Missing time -> UTC midnight, missing zone -> UTC. The host timezone never decides.
  const datePart = `${match[1]}-${match[2]}-${match[3]}`;
  const hours = match[4] ?? "00";
  const minutes = match[5] ?? "00";
  const seconds = match[6] ?? "00";
  const milliseconds = (match[7] ?? "0").padEnd(3, "0").slice(0, 3);
  const zone = match[8] ?? "Z";
  const date = new Date(`${datePart}T${hours}:${minutes}:${seconds}.${milliseconds}${zone}`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  // UTC round-trip: an offset-free input must render back with the very fields it came in
  // with, which proves no host timezone leaked into the parse and catches components the
  // parser would otherwise roll over (a 60th second, for example).
  const literalInstant = `${datePart}T${hours}:${minutes}:${seconds}.`;

  if (zone === "Z" && !date.toISOString().startsWith(literalInstant)) {
    return null;
  }

  return date;
}

/** Format a date as e.g. "Jun 9, 2026" (UTC, stable across SSR/CSR). */
export function formatDate(input: string | number | Date): string {
  const date = toDate(input);
  return date ? DATE.format(date) : "";
}

/** Format a date+time as e.g. "Jun 9, 2026, 04:25 PM" (UTC, stable across SSR/CSR). */
export function formatDateTime(input: string | number | Date): string {
  const date = toDate(input);
  return date ? DATE_TIME.format(date) : "";
}

/** Format a time as e.g. "04:25 PM" (UTC, stable across SSR/CSR). */
export function formatTime(input: string | number | Date): string {
  const date = toDate(input);
  return date ? TIME.format(date) : "";
}

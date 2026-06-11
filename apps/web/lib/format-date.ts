// Deterministic date formatting shared across server and client renders.
//
// Using a fixed locale ("en-US") and timeZone ("UTC") guarantees that the
// string produced during server-side rendering matches the string produced on
// the client during hydration. Bare `toLocale*` calls inherit the host locale
// and timezone, which differ between the server and the browser and cause React
// hydration mismatches (the rendered subtree is then thrown away and
// regenerated on the client).
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

function toDate(input: string | number | Date): Date | null {
  const date = input instanceof Date ? input : new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
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

import {
  DEFAULT_COLLECTION_PAGE_LIMIT,
  MAX_COLLECTION_PAGE_LIMIT,
  riskClassValues
} from "@agentic/contracts";
import { parseDashboardCollectionQuery } from "../apps/web/lib/dashboard-collection";
import { ApiRouteError } from "../apps/web/lib/api-response";
import {
  deriveIdempotencyKey,
  parseIdempotencyKey
} from "../apps/web/lib/request-idempotency";
import { formatDate, formatDateTime, formatTime } from "../apps/web/lib/format-date";

/**
 * Adversarial sweep over the pure input-parsing / normalization helpers in
 * `apps/web/lib`: idempotency-key derivation, dashboard collection query parsing
 * and the shared date formatter. Everything here runs on locally constructed
 * `Request` objects and literal fixtures: no network, no database, no clock.
 */

function buildGetRequest(pathname: string, headers?: Record<string, string>) {
  return new Request(`http://localhost${pathname}`, {
    method: "GET",
    headers
  });
}

describe("adversarial parsing: idempotency key derivation", () => {
  it("guards that supplied keys are trimmed, charset-checked and whitespace-only keys are treated as absent", () => {
    expect(parseIdempotencyKey(buildGetRequest("/api/x", { "x-idempotency-key": "retry-1" }))).toBe("retry-1");
    expect(parseIdempotencyKey(buildGetRequest("/api/x", { "x-idempotency-key": "   " }))).toBeNull();
    expect(parseIdempotencyKey(buildGetRequest("/api/x", { "x-idempotency-key": "\u00a0\u00a0" }))).toBeNull();
    expect(parseIdempotencyKey(buildGetRequest("/api/x"))).toBeNull();
    expect(parseIdempotencyKey(buildGetRequest("/api/x", { "x-idempotency-key": "a".repeat(200) }))).toHaveLength(200);

    expect(() =>
      parseIdempotencyKey(buildGetRequest("/api/x", { "x-idempotency-key": "a".repeat(201) }))
    ).toThrow(ApiRouteError);

    // Hostile but syntactically plausible shapes: separators inside the key are allowed,
    // unicode look-alikes, semicolons and stray markup are not.
    expect(parseIdempotencyKey(buildGetRequest("/api/x", { "x-idempotency-key": "ns:sub:key_01-A" }))).toBe(
      "ns:sub:key_01-A"
    );
    const hostileValues = ["\u00a0retry-1", "r\u00e9try", "retry; DROP TABLE jobs;--", "../../etc/passwd", "<script>1</script>"];

    for (const value of hostileValues) {
      let thrown: unknown = null;
      let returned: string | null = null;
      try {
        returned = parseIdempotencyKey(buildGetRequest("/api/x", { "x-idempotency-key": value }));
      } catch (error) {
        thrown = error;
      }
      // Either rejected outright, or normalised down to the bare URL-safe core; the one
      // thing that must never happen is a non-URL-safe key reaching the ledger.
      if (thrown !== null) {
        expect(thrown).toBeInstanceOf(ApiRouteError);
        if (thrown instanceof ApiRouteError) {
          expect(thrown.status).toBe(400);
        }
      } else {
        expect(returned).toMatch(/^[A-Za-z0-9:_-]{1,200}$/u);
      }
    }
  });

  it("guards that derived keys are user-scoped, method/path-sensitive and always inside the contract length cap", () => {
    const base = {
      namespace: "goal-create",
      userId: "owner",
      method: "post",
      pathname: "/api/goals",
      payload: { request: "Plan the week" }
    };
    const key = deriveIdempotencyKey(base);

    expect(key.startsWith("goal-create:")).toBe(true);
    // Namespace (<=80) + ":" + 32-char digest always fits `idempotencyKey` max(200).
    expect(key.length).toBeLessThanOrEqual(200);
    expect(/^[A-Za-z0-9:_-]+$/u.test(key)).toBe(true);
    // The method is upper-cased before hashing, so casing cannot split one logical call.
    expect(deriveIdempotencyKey({ ...base, method: "POST" })).toBe(key);

    expect(deriveIdempotencyKey({ ...base, userId: "someone-else" })).not.toBe(key);
    expect(deriveIdempotencyKey({ ...base, pathname: "/api/goals/" })).not.toBe(key);
    expect(deriveIdempotencyKey({ ...base, payload: { request: "Plan the month" } })).not.toBe(key);

    expect(() => deriveIdempotencyKey({ ...base, namespace: "goal.create" })).toThrow(ApiRouteError);
    expect(() => deriveIdempotencyKey({ ...base, namespace: "goal create" })).toThrow(ApiRouteError);
    expect(() => deriveIdempotencyKey({ ...base, namespace: "" })).toThrow(ApiRouteError);
    expect(() => deriveIdempotencyKey({ ...base, namespace: "n".repeat(81) })).toThrow(ApiRouteError);
  });

  it("guards that key insertion order and JSON-equivalent shapes hash to the same derived key", () => {
    const ordered = deriveIdempotencyKey({
      namespace: "goal-create",
      userId: "owner",
      method: "POST",
      pathname: "/api/goals",
      payload: { a: 1, b: [1, 2], c: { d: "x", e: null } }
    });
    const shuffled = deriveIdempotencyKey({
      namespace: "goal-create",
      userId: "owner",
      method: "POST",
      pathname: "/api/goals",
      payload: { c: { e: null, d: "x" }, b: [1, 2], a: 1 }
    });

    expect(shuffled).toBe(ordered);
    // `null`, `[]` and `{}` are distinct shapes and must not be conflated.
    const shape = (payload: unknown) =>
      deriveIdempotencyKey({
        namespace: "goal-create",
        userId: "owner",
        method: "POST",
        pathname: "/api/goals",
        payload
      });

    expect(new Set([shape(null), shape({}), shape([]), shape({ a: null }), shape({ a: undefined })]).size).toBe(5);
  });

  it("guards that payloads holding Date/Map/Set/class instances hash distinctly, so different writes never share one key", () => {
    const derive = (payload: unknown) =>
      deriveIdempotencyKey({
        namespace: "briefing-create",
        userId: "owner",
        method: "POST",
        pathname: "/api/briefings",
        payload
      });

    const early = derive({ at: new Date("2026-01-01T00:00:00.000Z"), focus: "urgent" });
    const late = derive({ at: new Date("2099-12-31T23:59:59.999Z"), focus: "urgent" });
    const mapped = derive({ at: new Map([["zone", "Asia/Singapore"]]), focus: "urgent" });
    const listed = derive({ at: new Set(["Asia/Singapore"]), focus: "urgent" });
    const empty = derive({ at: {}, focus: "urgent" });

    class BriefingSlot {
      zone = "Asia/Singapore";
    }

    const instance = derive({ at: new BriefingSlot(), focus: "urgent" });

    // Regression: `stableJson()` serialised every non-plain object (Date, Map, Set, class
    // instance) to `{}`, so genuinely different requests shared one idempotency key and the
    // second write was silently absorbed as a duplicate. Each shape now carries a type tag.
    expect(new Set([early, late, mapped, listed, instance, empty]).size).toBe(6);
    // Deterministic: equal values keep deriving one key, and Map/Set iteration order is
    // normalised so a re-built collection cannot split a logical call.
    expect(early).toBe(derive({ at: new Date("2026-01-01T00:00:00.000Z"), focus: "urgent" }));
    expect(derive({ at: new Map([["b", 2], ["a", 1]]), focus: "urgent" })).toBe(
      derive({ at: new Map([["a", 1], ["b", 2]]), focus: "urgent" })
    );
    expect(derive({ at: new Set(["b", "a"]), focus: "urgent" })).toBe(
      derive({ at: new Set(["a", "b"]), focus: "urgent" })
    );
    expect(derive({ at: new Date("not-a-date"), focus: "urgent" })).toBe(
      derive({ at: new Date("also-not-a-date"), focus: "urgent" })
    );
  });

  it("guards that canonically-equivalent unicode keys derive one key regardless of insertion order", () => {
    const derive = (payload: Record<string, unknown>) =>
      deriveIdempotencyKey({
        namespace: "approval-decide",
        userId: "owner",
        method: "POST",
        pathname: "/api/approvals/a",
        payload
      });

    const nfcFirst: Record<string, unknown> = {};
    nfcFirst["\u00e9"] = 1;
    nfcFirst["e\u0301"] = 2;

    const nfdFirst: Record<string, unknown> = {};
    nfdFirst["e\u0301"] = 2;
    nfdFirst["\u00e9"] = 1;

    // Precomposed "\u00e9" and decomposed "e\u0301" collide under ICU collation ...
    expect("\u00e9".localeCompare("e\u0301")).toBe(0);

    // Regression: `stableJson()` sorted keys with `localeCompare`, so that tie left the
    // (stable) sort in the caller's insertion order and one logical payload derived two keys
    // depending on how the body was re-serialised between retries. Ordering is now a
    // locale-free code-unit comparison, which is a total order.
    expect(derive(nfdFirst)).toBe(derive(nfcFirst));
    // Distinct values behind those keys are still never conflated.
    expect(derive({ "\u00e9": 2, "e\u0301": 1 })).not.toBe(derive(nfcFirst));
  });
});

describe("adversarial parsing: dashboard collection query", () => {
  it("guards that the limit contract rejects out-of-range and fractional values while honouring the documented default and ceiling", () => {
    const limitOf = (search: string) =>
      parseDashboardCollectionQuery(buildGetRequest(`/api/dashboard/goals${search}`), {}).limit;

    expect(limitOf("")).toBe(20);
    expect(limitOf("?limit=1")).toBe(1);
    expect(limitOf(`?limit=${MAX_COLLECTION_PAGE_LIMIT}`)).toBe(MAX_COLLECTION_PAGE_LIMIT);
    expect(() => limitOf(`?limit=${MAX_COLLECTION_PAGE_LIMIT + 1}`)).toThrow();
    expect(() => limitOf("?limit=0")).toThrow();
    expect(() => limitOf("?limit=-1")).toThrow();
    expect(() => limitOf("?limit=-0")).toThrow();
    expect(() => limitOf("?limit=1.5")).toThrow();
    expect(() => limitOf("?limit=NaN")).toThrow();
    expect(() => limitOf("?limit=Infinity")).toThrow();
  });

  it("guards that the page limit must be written as a plain decimal number, not a JS numeric literal", () => {
    const limitOf = (search: string) =>
      parseDashboardCollectionQuery(buildGetRequest(`/api/dashboard/goals${search}`), {}).limit;

    expect(limitOf("?limit=7")).toBe(7);

    // Regression: `limit` used `z.coerce.number()`, which is `Number(input)` and therefore
    // accepted every JS numeric literal form plus surrounding whitespace. The public contract
    // says "1-100 decimal", so the raw query text is now shape-checked before it is coerced.
    for (const search of [
      "?limit=0x14",
      "?limit=0o11",
      "?limit=0b101",
      "?limit=1e2",
      "?limit=%207%20",
      "?limit=+3",
      "?limit=3.0",
      "?limit=1_0",
      "?limit=7d",
      "?limit=0007"
    ]) {
      expect(() => limitOf(search)).toThrow(ApiRouteError);
    }

    // Regression: an out-of-range but decimal-shaped limit used to slip past the shape check and
    // reject with a raw, field-less Zod message, while a malformed limit got the friendly
    // ApiRouteError. Both now surface the same bounded ApiRouteError.
    expect(() => limitOf(`?limit=${MAX_COLLECTION_PAGE_LIMIT + 1}`)).toThrow(ApiRouteError);
    expect(() => limitOf("?limit=0")).toThrow(ApiRouteError);
    expect(() => limitOf(`?limit=${MAX_COLLECTION_PAGE_LIMIT + 1}`)).toThrow(/decimal page size between 1 and/);
  });

  it("guards that present-but-empty query parameters reset to the default instead of failing", () => {
    const parse = (search: string) =>
      parseDashboardCollectionQuery(buildGetRequest(`/api/dashboard/goals${search}`), {
        allowedFilters: ["status", "riskClass", "bucket", "kind"]
      });

    expect(parse("?q=").q).toBe("");

    // Regression: `cursor`/`sort` were read with `searchParams.get(...)` without the blank
    // normalisation applied to `limit`/`q`, so the standard reset request shape (`?cursor=`,
    // i.e. "go back to page one") failed validation with a hard 400 instead of the default.
    expect(parse("?cursor=").cursor).toBeNull();
    expect(parse("?sort=").sort).toBe("created_desc");
    expect(parse("?limit=").limit).toBe(DEFAULT_COLLECTION_PAGE_LIMIT);
    expect(parse("?cursor=%20").cursor).toBeNull();
    expect(parse("?status=&riskClass=&bucket=&kind=").status).toBeUndefined();
    // Blank resets still compose with real values on the same request.
    expect(parse("?cursor=&sort=updated_asc&limit=5").sort).toBe("updated_asc");
    expect(parse("").cursor).toBeNull();
    expect(parse("").sort).toBe("created_desc");
  });

  it("guards that unknown, duplicate and prototype-named query parameters are refused before they reach the schema", () => {
    const parse = (
      search: string,
      options: Parameters<typeof parseDashboardCollectionQuery>[1] = {}
    ) => parseDashboardCollectionQuery(buildGetRequest(`/api/dashboard/goals${search}`), options);

    expect(() => parse("?unknown=1")).toThrow(ApiRouteError);
    expect(() => parse("?limit=5&limit=5")).toThrow(ApiRouteError);
    expect(() => parse("?__proto__=1")).toThrow(ApiRouteError);
    expect(() => parse("?=1")).toThrow(ApiRouteError);
    expect(() => parse("? Limit=5")).toThrow(ApiRouteError);
    expect({}).not.toHaveProperty("dashboardQueryFilter");

    expect(() => parse("?status=running")).toThrow(ApiRouteError);
    expect(parse("?status=running", { allowedFilters: ["status"] }).status).toBe("running");
    expect(parse("?status=%20running%20", { allowedFilters: ["status"] }).status).toBe("running");

    // Filters are allow-listed by value too, so a valid-looking enum member from another
    // surface cannot be smuggled through.
    expect(() => parse("?riskClass=R9", { allowedFilters: ["riskClass"] })).toThrow();
    expect(() => parse(`?riskClass=${riskClassValues[0].toLowerCase()}`, { allowedFilters: ["riskClass"] })).toThrow();
    expect(parse(`?riskClass=${riskClassValues[0]}`, { allowedFilters: ["riskClass"] }).riskClass).toBe(riskClassValues[0]);
    expect(() =>
      parse("?status=nope", { allowedFilters: ["status"], allowedStatusValues: ["running"] })
    ).toThrow(ApiRouteError);
    expect(() =>
      parse("?status=%27%20OR%201%3D1--", { allowedFilters: ["status"], allowedStatusValues: ["running"] })
    ).toThrow(ApiRouteError);
  });

  it("guards that the search term bound rejects oversized input", () => {
    const query = (search: string) =>
      parseDashboardCollectionQuery(buildGetRequest(`/api/dashboard/goals${search}`), {}).q;

    // Zod 4.5.2+ measures .max() by Unicode code points, not UTF-16 code units.
    // 120 emoji = 120 code points = exactly at the limit.
    expect(query(`?q=${"\u{1F600}".repeat(120)}`).length).toBe(240);
    expect(() => query(`?q=${"\u{1F600}".repeat(121)}`)).toThrow();
    expect(query("?q=%20%20trimmed%20%20")).toBe("trimmed");
    expect(() => query(`?q=${"x".repeat(5000)}`)).toThrow();
  });

  it("guards that cursor input is only length-checked here, so an opaque cursor is never partially normalised", () => {
    const parse = (search: string) =>
      parseDashboardCollectionQuery(buildGetRequest(`/api/dashboard/goals${search}`), {});

    expect(parse(`?cursor=${"c".repeat(400)}`).cursor).toBe("c".repeat(400));
    expect(() => parse(`?cursor=${"c".repeat(401)}`)).toThrow();
    // Hostile cursor content is passed through untouched for the repository to reject.
    expect(parse("?cursor=../../etc/passwd").cursor).toBe("../../etc/passwd");
    expect(parse("?cursor=%27%3B%20DROP%20TABLE%20jobs%3B--").cursor).toBe("'; DROP TABLE jobs;--");
    expect(parse("?cursor=MTc1MDAwMDAwMDAwMA%3D%3D").cursor).toBe("MTc1MDAwMDAwMDAwMA==");
  });
});

describe("adversarial parsing: shared UTC date formatter", () => {
  it("guards that ISO UTC instants render identically for string, number and Date inputs", () => {
    const iso = "2026-06-09T16:25:00.000Z";

    expect(formatDate(iso)).toBe("Jun 9, 2026");
    expect(formatDate(new Date(iso))).toBe("Jun 9, 2026");
    expect(formatDate(Date.parse(iso))).toBe("Jun 9, 2026");
    expect(formatDateTime(iso)).toContain("2026");
    expect(formatTime(iso)).toContain("PM");
  });

  it("guards that unparseable, numeric-string and out-of-range timestamp input degrades to an empty string", () => {
    expect(formatDate("")).toBe("");
    expect(formatDate("   ")).toBe("");
    expect(formatDate("not-a-date")).toBe("");
    expect(formatDate("1717948800000")).toBe("");
    expect(formatDate(8.65e15)).toBe("");
    expect(formatDate(Number.MAX_SAFE_INTEGER)).toBe("");
    expect(formatDate(Number.NaN)).toBe("");
    expect(formatDate(undefined as unknown as string)).toBe("");
  });

  it("guards that an impossible calendar date renders empty instead of rolling over", () => {
    // Regression: `toDate()` only checked `Number.isNaN`, and the JS date parser rolls
    // out-of-range components over into a neighbouring real date ("2026-02-30" becomes
    // 2026-03-02), so a malformed timestamp from an external payload rendered as a
    // plausible-but-wrong date instead of the empty string the helper promises.
    expect(formatDate("2026-02-30")).toBe("");
    expect(formatDate("2026-02-30T10:00:00Z")).toBe("");
    expect(formatDate("2025-02-29")).toBe("");
    expect(formatDate("2026-00-10")).toBe("");
    expect(formatDate("2026-13-01")).toBe("");
    expect(formatDate("2026-06-31")).toBe("");
    expect(formatDate("2026-06-09T25:00:00Z")).toBe("");
    // Real instants still format, including a genuine leap day, plain dates and offsets.
    expect(formatDate("2026-02-28")).toBe("Feb 28, 2026");
    expect(formatDate("2024-02-29")).toBe("Feb 29, 2024");
    expect(formatDate("2026-06-09")).toBe("Jun 9, 2026");
    expect(formatDate("2026-06-09T16:25:00+02:00")).toBe("Jun 9, 2026");
    // Host-independent: a zone-less ISO datetime is read as UTC, never in the machine's zone.
    expect(formatDateTime("2026-06-09T16:25")).toBe(formatDateTime("2026-06-09T16:25:00Z"));
  });

  it("guards that null-ish timestamps render empty instead of the unix epoch", () => {
    // Regression: `toDate(null)` reached `new Date(null)` (epoch 0) because there was no
    // nullish guard, so a nullable timestamp arriving as `null` rendered "Jan 1, 1970" while
    // the equivalent `undefined` rendered nothing.
    expect(formatDate(null as unknown as string)).toBe("");
    expect(formatDateTime(null as unknown as string)).toBe("");
    expect(formatTime(null as unknown as string)).toBe("");
    expect(formatDate(undefined as unknown as string)).toBe("");
    // A real epoch instant is still a real date.
    expect(formatDate(0)).toBe("Jan 1, 1970");
    expect(formatDate(new Date(0))).toBe("Jan 1, 1970");
  });
});

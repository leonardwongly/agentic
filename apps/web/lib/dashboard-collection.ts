import { z } from "zod";
import {
  DEFAULT_COLLECTION_PAGE_LIMIT,
  MAX_COLLECTION_PAGE_LIMIT,
  commitmentInboxBucketValues,
  riskClassValues
} from "@agentic/contracts";
import type { DashboardCollectionPage as RepositoryDashboardCollectionPage } from "@agentic/repository";
import { ApiRouteError } from "./api-response";

export const dashboardCollectionSortValues = [
  "created_desc",
  "created_asc",
  "updated_desc",
  "updated_asc",
  "title_asc",
  "title_desc"
] as const;

export type DashboardCollectionSort = (typeof dashboardCollectionSortValues)[number];
export type DashboardCollectionFilter = "status" | "riskClass" | "bucket" | "kind";

export type DashboardCollectionQuery = {
  limit: number;
  cursor: string | null;
  q: string;
  sort: DashboardCollectionSort;
  status?: string;
  riskClass?: (typeof riskClassValues)[number];
  bucket?: (typeof commitmentInboxBucketValues)[number];
  kind?: string;
};

export type DashboardCollectionPage<TItem> = {
  items: TItem[];
  totalCount: number;
  limit: number;
  nextCursor: string | null;
  generatedAt: string;
};

// The published contract for `limit` is a plain decimal page size (1-100). `Number()` coercion
// would also accept `0x14`, `0o11`, `0b101`, `1e2`, `+3`, `3.0` and surrounding whitespace, so
// the raw query text is checked before it is ever converted.
const DECIMAL_PAGE_LIMIT_PATTERN = /^\d{1,3}$/u;

const DashboardCollectionQuerySchema = z
  .object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_COLLECTION_PAGE_LIMIT)
      .default(DEFAULT_COLLECTION_PAGE_LIMIT),
    cursor: z.string().trim().min(1).max(400).nullable().default(null),
    q: z.string().trim().max(120).default(""),
    sort: z.enum(dashboardCollectionSortValues).default("created_desc"),
    status: z.string().trim().min(1).max(64).optional(),
    riskClass: z.enum(riskClassValues).optional(),
    bucket: z.enum(commitmentInboxBucketValues).optional(),
    kind: z.string().trim().min(1).max(64).optional()
  })
  .strict();

/**
 * Optional query params must treat "present but blank" (`?cursor=`, `?sort=`) the same as
 * absent: clearing a filter by sending the empty value is the standard reset-to-page-one
 * request shape, and it must not turn into a hard 400 from `min(1)` / enum checks.
 */
function optionalQueryParam(url: URL, key: string): string | undefined {
  const raw = url.searchParams.get(key);

  if (raw === null) {
    return undefined;
  }

  return raw.trim().length > 0 ? raw : undefined;
}

function pageLimitQueryParam(url: URL): number | undefined {
  const raw = url.searchParams.get("limit");

  if (raw === null || raw.trim().length === 0) {
    return undefined;
  }

  if (!DECIMAL_PAGE_LIMIT_PATTERN.test(raw)) {
    throw new ApiRouteError(
      400,
      `Invalid dashboard limit; expected a decimal page size between 1 and ${MAX_COLLECTION_PAGE_LIMIT}.`
    );
  }

  return Number(raw);
}

function assertAllowedQueryKeys(request: Request, allowedFilters: DashboardCollectionFilter[]) {
  const url = new URL(request.url);
  const allowedKeys = new Set<string>(["limit", "cursor", "q", "sort", ...allowedFilters]);

  for (const key of url.searchParams.keys()) {
    if (!allowedKeys.has(key)) {
      throw new ApiRouteError(400, `Unknown dashboard query parameter: ${key}.`);
    }

    if (url.searchParams.getAll(key).length > 1) {
      throw new ApiRouteError(400, `Duplicate dashboard query parameter: ${key}.`);
    }
  }
}

function assertAllowedValue(value: string | undefined, allowedValues: readonly string[] | undefined, label: string) {
  if (value === undefined || allowedValues === undefined) {
    return;
  }

  if (!allowedValues.includes(value)) {
    throw new ApiRouteError(400, `Invalid dashboard ${label} filter.`);
  }
}

export function parseDashboardCollectionQuery(
  request: Request,
  options: {
    allowedFilters?: DashboardCollectionFilter[];
    allowedStatusValues?: readonly string[];
    allowedKindValues?: readonly string[];
  } = {}
): DashboardCollectionQuery {
  const allowedFilters = options.allowedFilters ?? [];
  assertAllowedQueryKeys(request, allowedFilters);

  const url = new URL(request.url);
  const parsed = DashboardCollectionQuerySchema.parse({
    limit: pageLimitQueryParam(url),
    cursor: optionalQueryParam(url, "cursor"),
    q: optionalQueryParam(url, "q"),
    sort: optionalQueryParam(url, "sort"),
    status: optionalQueryParam(url, "status"),
    riskClass: optionalQueryParam(url, "riskClass"),
    bucket: optionalQueryParam(url, "bucket"),
    kind: optionalQueryParam(url, "kind")
  });

  assertAllowedValue(parsed.status, options.allowedStatusValues, "status");
  assertAllowedValue(parsed.kind, options.allowedKindValues, "kind");

  return parsed;
}

export function buildDashboardCollectionPage<TItem>(
  page: RepositoryDashboardCollectionPage<TItem>
): DashboardCollectionPage<TItem> {
  return {
    items: page.items,
    totalCount: page.totalCount,
    limit: page.limit,
    nextCursor: page.nextCursor,
    generatedAt: page.generatedAt
  };
}

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

const DashboardCollectionQuerySchema = z
  .object({
    limit: z.coerce
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
    limit: url.searchParams.get("limit") ?? undefined,
    cursor: url.searchParams.get("cursor"),
    q: url.searchParams.get("q") ?? undefined,
    sort: url.searchParams.get("sort") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    riskClass: url.searchParams.get("riskClass") ?? undefined,
    bucket: url.searchParams.get("bucket") ?? undefined,
    kind: url.searchParams.get("kind") ?? undefined
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

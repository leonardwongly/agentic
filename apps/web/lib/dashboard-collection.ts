import { z } from "zod";
import {
  DEFAULT_COLLECTION_PAGE_LIMIT,
  MAX_COLLECTION_PAGE_LIMIT,
  commitmentInboxBucketValues,
  nowIso,
  riskClassValues
} from "@agentic/contracts";
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

const DASHBOARD_CURSOR_MAX_OFFSET = 1_000_000;
const DashboardOffsetCursorSchema = z
  .object({
    offset: z.number().int().min(0).max(DASHBOARD_CURSOR_MAX_OFFSET)
  })
  .strict();

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

function encodeDashboardCursor(offset: number): string {
  return Buffer.from(JSON.stringify(DashboardOffsetCursorSchema.parse({ offset })), "utf8").toString("base64url");
}

function decodeDashboardCursor(cursor: string | null): number {
  if (!cursor) {
    return 0;
  }

  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    return DashboardOffsetCursorSchema.parse(parsed).offset;
  } catch {
    throw new ApiRouteError(400, "Dashboard cursor is invalid.");
  }
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase();
}

function compareText(left: string, right: string): number {
  const result = left.localeCompare(right, "en-US", { sensitivity: "base" });
  return result === 0 ? left.localeCompare(right) : result;
}

function compareIso(left: string, right: string): number {
  return left.localeCompare(right);
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
  items: TItem[],
  query: DashboardCollectionQuery,
  accessors: {
    getId: (item: TItem) => string;
    getCreatedAt: (item: TItem) => string;
    getUpdatedAt?: (item: TItem) => string;
    getTitle?: (item: TItem) => string;
    getSearchText?: (item: TItem) => string;
  }
): DashboardCollectionPage<TItem> {
  const search = normalizeSearchText(query.q);
  const matched =
    search.length > 0 && accessors.getSearchText
      ? items.filter((item) => normalizeSearchText(accessors.getSearchText!(item)).includes(search))
      : items;
  const sorted = [...matched].sort((left, right) => {
    const leftId = accessors.getId(left);
    const rightId = accessors.getId(right);
    let comparison = 0;

    if (query.sort === "created_asc" || query.sort === "created_desc") {
      comparison = compareIso(accessors.getCreatedAt(left), accessors.getCreatedAt(right));
      if (query.sort === "created_desc") {
        comparison *= -1;
      }
    } else if (query.sort === "updated_asc" || query.sort === "updated_desc") {
      comparison = compareIso(
        accessors.getUpdatedAt?.(left) ?? accessors.getCreatedAt(left),
        accessors.getUpdatedAt?.(right) ?? accessors.getCreatedAt(right)
      );
      if (query.sort === "updated_desc") {
        comparison *= -1;
      }
    } else {
      comparison = compareText(accessors.getTitle?.(left) ?? leftId, accessors.getTitle?.(right) ?? rightId);
      if (query.sort === "title_desc") {
        comparison *= -1;
      }
    }

    return comparison !== 0 ? comparison : compareText(leftId, rightId);
  });
  const offset = decodeDashboardCursor(query.cursor);
  const pageItems = sorted.slice(offset, offset + query.limit);
  const nextOffset = offset + pageItems.length;

  return {
    items: pageItems,
    totalCount: sorted.length,
    limit: query.limit,
    nextCursor: nextOffset < sorted.length ? encodeDashboardCursor(nextOffset) : null,
    generatedAt: nowIso()
  };
}

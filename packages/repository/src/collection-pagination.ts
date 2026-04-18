import { z } from "zod";
import {
  DEFAULT_COLLECTION_PAGE_LIMIT,
  MAX_COLLECTION_PAGE_LIMIT,
  nowIso
} from "@agentic/contracts";

const CollectionCursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().min(1)
});

type CollectionCursor = z.infer<typeof CollectionCursorSchema>;

export class CollectionPageQueryError extends Error {
  constructor(
    public readonly code: "invalid_cursor",
    message: string
  ) {
    super(message);
    this.name = "CollectionPageQueryError";
  }
}

export function compareCreatedDescKeys(left: CollectionCursor, right: CollectionCursor): number {
  const createdComparison = right.createdAt.localeCompare(left.createdAt);
  return createdComparison !== 0 ? createdComparison : right.id.localeCompare(left.id);
}

export function compareCreatedAscKeys(left: CollectionCursor, right: CollectionCursor): number {
  const createdComparison = left.createdAt.localeCompare(right.createdAt);
  return createdComparison !== 0 ? createdComparison : left.id.localeCompare(right.id);
}

export function normalizeCollectionPageLimit(limit?: number): number {
  if (limit === undefined) {
    return DEFAULT_COLLECTION_PAGE_LIMIT;
  }

  const normalized = Math.trunc(limit);

  if (!Number.isFinite(normalized) || normalized < 1 || normalized > MAX_COLLECTION_PAGE_LIMIT) {
    return DEFAULT_COLLECTION_PAGE_LIMIT;
  }

  return normalized;
}

export function encodeCollectionCursor(cursor: CollectionCursor): string {
  return Buffer.from(JSON.stringify(CollectionCursorSchema.parse(cursor)), "utf8").toString("base64url");
}

export function decodeCollectionCursor(cursor?: string | null): CollectionCursor | null {
  if (!cursor) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    return CollectionCursorSchema.parse(parsed);
  } catch {
    throw new CollectionPageQueryError("invalid_cursor", "Collection page cursor is invalid.");
  }
}

function isItemAfterCursor(cursor: CollectionCursor, candidate: CollectionCursor): boolean {
  if (candidate.createdAt !== cursor.createdAt) {
    return candidate.createdAt.localeCompare(cursor.createdAt) < 0;
  }

  return candidate.id.localeCompare(cursor.id) < 0;
}

export function sortByCreatedDesc<T extends { createdAt: string; id?: string }>(items: T[]): T[] {
  return [...items].sort((left, right) =>
    compareCreatedDescKeys(
      { createdAt: left.createdAt, id: left.id ?? "" },
      { createdAt: right.createdAt, id: right.id ?? "" }
    )
  );
}

export function sortByCreatedAsc<T extends { createdAt: string; id?: string }>(items: T[]): T[] {
  return [...items].sort((left, right) =>
    compareCreatedAscKeys(
      { createdAt: left.createdAt, id: left.id ?? "" },
      { createdAt: right.createdAt, id: right.id ?? "" }
    )
  );
}

export function buildCollectionPage<TItem, TPage>(params: {
  items: TItem[];
  limit?: number;
  cursor?: string | null;
  getCursorKey: (item: TItem) => CollectionCursor;
  parsePage: (page: {
    items: TItem[];
    limit: number;
    nextCursor: string | null;
    generatedAt: string;
  }) => TPage;
}): TPage {
  const limit = normalizeCollectionPageLimit(params.limit);
  const cursor = decodeCollectionCursor(params.cursor);
  const sorted = [...params.items].sort((left, right) =>
    compareCreatedDescKeys(params.getCursorKey(left), params.getCursorKey(right))
  );
  const filtered = cursor
    ? sorted.filter((item) => isItemAfterCursor(cursor, params.getCursorKey(item)))
    : sorted;
  const pageItems = filtered.slice(0, limit);
  const nextCursor =
    filtered.length > limit ? encodeCollectionCursor(params.getCursorKey(pageItems[pageItems.length - 1]!)) : null;

  return params.parsePage({
    items: pageItems,
    limit,
    nextCursor,
    generatedAt: nowIso()
  });
}

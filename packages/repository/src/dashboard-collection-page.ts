import { z } from "zod";
import {
  ActionLogSchema,
  ApprovalRequestSchema,
  ArtifactSchema,
  CommitmentSchema,
  JobRecordSchema,
  MemoryRecordSchema,
  DEFAULT_OWNER_USER_ID,
  clone,
  nowIso,
  type ActionLog,
  type ApprovalRequest,
  type Artifact,
  type Commitment,
  type GoalBundle,
  type JobRecord,
  type MemoryRecord
} from "@agentic/contracts";
import { CollectionPageQueryError, normalizeCollectionPageLimit } from "./collection-pagination";
import { mergeCommitments } from "./commitment-helpers";
import type {
  DashboardCollectionPage,
  DashboardCollectionPageParams,
  DashboardCollectionRepositoryPort,
  DashboardCollectionSort
} from "./repository-types";

const DashboardCollectionCursorSchema = z
  .object({
    sort: z.enum(["created_desc", "created_asc", "updated_desc", "updated_asc", "title_asc", "title_desc"]),
    value: z.string().min(1),
    id: z.string().min(1)
  })
  .strict();

type DashboardCollectionCursor = z.infer<typeof DashboardCollectionCursorSchema>;

const DASHBOARD_DUE_SOON_MS = 72 * 60 * 60 * 1000;
const DASHBOARD_COLLECTION_SCAN_PAGE_LIMIT = 100;
const DASHBOARD_COLLECTION_MAX_SCAN_ITEMS = 1_000;

function isDashboardCommitmentDueSoon(commitment: Commitment): boolean {
  if (!commitment.dueAt) {
    return false;
  }

  const dueAtMs = Date.parse(commitment.dueAt);
  return Number.isFinite(dueAtMs) && dueAtMs <= Date.now() + DASHBOARD_DUE_SOON_MS;
}

export function matchesDashboardCommitmentBucket(commitment: Commitment, bucket: string): boolean {
  if (bucket === "all") {
    return true;
  }

  if (bucket === "completed") {
    return commitment.status === "completed" || commitment.status === "dismissed";
  }

  if (bucket === "urgent") {
    return commitment.urgency === "immediate" || commitment.urgency === "today" || commitment.status === "needs-review";
  }

  if (bucket === "due_soon") {
    return isDashboardCommitmentDueSoon(commitment);
  }

  if (bucket === "waiting_on_others") {
    return commitment.status === "blocked" || commitment.status === "needs-review";
  }

  if (bucket === "low_confidence") {
    return commitment.confidence < 0.75;
  }

  return commitment.status !== "completed" && commitment.status !== "dismissed";
}

function encodeDashboardCollectionCursor(cursor: DashboardCollectionCursor): string {
  return Buffer.from(JSON.stringify(DashboardCollectionCursorSchema.parse(cursor)), "utf8").toString("base64url");
}

function decodeDashboardCollectionCursor(
  cursor: string | null | undefined,
  sort: DashboardCollectionSort
): DashboardCollectionCursor | null {
  if (!cursor) {
    return null;
  }

  try {
    const parsed = DashboardCollectionCursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));

    if (parsed.sort !== sort) {
      throw new Error("sort mismatch");
    }

    return parsed;
  } catch {
    throw new CollectionPageQueryError("invalid_cursor", "Dashboard collection cursor is invalid.");
  }
}

function normalizeSearch(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function compareText(left: string, right: string): number {
  const result = left.localeCompare(right, "en-US", { sensitivity: "base" });
  return result === 0 ? left.localeCompare(right) : result;
}

function compareCursorKeys(
  left: DashboardCollectionCursor,
  right: DashboardCollectionCursor,
  sort: DashboardCollectionSort
): number {
  const isDesc = sort === "created_desc" || sort === "updated_desc" || sort === "title_desc";
  const valueComparison = compareText(left.value, right.value);
  const orderedValueComparison = isDesc ? valueComparison * -1 : valueComparison;

  return orderedValueComparison !== 0 ? orderedValueComparison : compareText(left.id, right.id);
}

function isAfterCursor(
  candidate: DashboardCollectionCursor,
  cursor: DashboardCollectionCursor,
  sort: DashboardCollectionSort
): boolean {
  return compareCursorKeys(candidate, cursor, sort) > 0;
}

export function buildDashboardRepositoryCollectionPage<TItem>(params: {
  items: TItem[];
  limit?: number;
  cursor?: string | null;
  sort?: DashboardCollectionSort;
  q?: string;
  getId: (item: TItem) => string;
  getCreatedAt: (item: TItem) => string;
  getUpdatedAt?: (item: TItem) => string;
  getTitle?: (item: TItem) => string;
  getSearchText?: (item: TItem) => string;
  parseItem: (item: TItem) => TItem;
}): DashboardCollectionPage<TItem> {
  const limit = normalizeCollectionPageLimit(params.limit);
  const sort = params.sort ?? "created_desc";
  const cursor = decodeDashboardCollectionCursor(params.cursor, sort);
  const search = normalizeSearch(params.q);
  const matched =
    search.length > 0 && params.getSearchText
      ? params.items.filter((item) => normalizeSearch(params.getSearchText?.(item)).includes(search))
      : params.items;
  const getCursorKey = (item: TItem): DashboardCollectionCursor => {
    const id = params.getId(item);

    if (sort === "updated_asc" || sort === "updated_desc") {
      return {
        sort,
        id,
        value: params.getUpdatedAt?.(item) ?? params.getCreatedAt(item)
      };
    }

    if (sort === "title_asc" || sort === "title_desc") {
      return {
        sort,
        id,
        value: params.getTitle?.(item) ?? id
      };
    }

    return {
      sort,
      id,
      value: params.getCreatedAt(item)
    };
  };
  const sorted = [...matched].sort((left, right) => compareCursorKeys(getCursorKey(left), getCursorKey(right), sort));
  const cursorFiltered = cursor ? sorted.filter((item) => isAfterCursor(getCursorKey(item), cursor, sort)) : sorted;
  const pageItems = cursorFiltered.slice(0, limit).map((item) => params.parseItem(item));
  const lastItem = pageItems.at(-1);

  return {
    items: pageItems,
    totalCount: sorted.length,
    limit,
    nextCursor:
      cursorFiltered.length > limit && lastItem
        ? encodeDashboardCollectionCursor(getCursorKey(lastItem))
        : null,
    generatedAt: nowIso()
  };
}

export function buildDashboardApprovalsPage(
  approvals: ApprovalRequest[],
  params?: DashboardCollectionPageParams
): DashboardCollectionPage<ApprovalRequest> {
  return buildDashboardRepositoryCollectionPage({
    items: approvals,
    limit: params?.limit,
    cursor: params?.cursor,
    sort: params?.sort,
    q: params?.q,
    getId: (approval) => approval.id,
    getCreatedAt: (approval) => approval.createdAt,
    getUpdatedAt: (approval) => approval.respondedAt ?? approval.createdAt,
    getTitle: (approval) => approval.title,
    getSearchText: (approval) =>
      [approval.id, approval.title, approval.rationale, approval.requestedAction, approval.riskClass].join(" "),
    parseItem: (approval) => ApprovalRequestSchema.parse(clone(approval))
  });
}

export function buildDashboardCommitmentsPage(
  commitments: Commitment[],
  params?: DashboardCollectionPageParams
): DashboardCollectionPage<Commitment> {
  return buildDashboardRepositoryCollectionPage({
    items: commitments,
    limit: params?.limit,
    cursor: params?.cursor,
    sort: params?.sort,
    q: params?.q,
    getId: (commitment) => commitment.id,
    getCreatedAt: (commitment) => commitment.createdAt,
    getUpdatedAt: (commitment) => commitment.updatedAt,
    getTitle: (commitment) => commitment.title,
    getSearchText: (commitment) =>
      [
        commitment.id,
        commitment.title,
        commitment.summary,
        commitment.status,
        commitment.provenanceSummary,
        commitment.evidence.map((item) => item.label).join(" ")
      ].join(" "),
    parseItem: (commitment) => CommitmentSchema.parse(clone(commitment))
  });
}

export function buildDashboardJobsPage(
  jobs: JobRecord[],
  params?: DashboardCollectionPageParams
): DashboardCollectionPage<JobRecord> {
  return buildDashboardRepositoryCollectionPage({
    items: jobs,
    limit: params?.limit,
    cursor: params?.cursor,
    sort: params?.sort,
    q: params?.q,
    getId: (job) => job.id,
    getCreatedAt: (job) => job.createdAt,
    getUpdatedAt: (job) => job.updatedAt,
    getTitle: (job) => job.id,
    getSearchText: (job) =>
      [job.id, job.kind, job.status, job.lastError ?? "", JSON.stringify(job.payload)].join(" "),
    parseItem: (job) => JobRecordSchema.parse(clone(job))
  });
}

export function buildDashboardMemoryPage(
  memories: MemoryRecord[],
  params?: DashboardCollectionPageParams
): DashboardCollectionPage<MemoryRecord> {
  return buildDashboardRepositoryCollectionPage({
    items: memories,
    limit: params?.limit,
    cursor: params?.cursor,
    sort: params?.sort,
    q: params?.q,
    getId: (memory) => memory.id,
    getCreatedAt: (memory) => memory.createdAt,
    getUpdatedAt: (memory) => memory.updatedAt,
    getTitle: (memory) => memory.category,
    getSearchText: (memory) => [memory.id, memory.category, memory.content, memory.source].join(" "),
    parseItem: (memory) => MemoryRecordSchema.parse(clone(memory))
  });
}

export function buildDashboardActionLogsPage(
  actionLogs: ActionLog[],
  params?: DashboardCollectionPageParams
): DashboardCollectionPage<ActionLog> {
  return buildDashboardRepositoryCollectionPage({
    items: actionLogs,
    limit: params?.limit,
    cursor: params?.cursor,
    sort: params?.sort,
    q: params?.q,
    getId: (log) => log.id,
    getCreatedAt: (log) => log.createdAt,
    getTitle: (log) => log.kind,
    getSearchText: (log) => [log.id, log.kind, log.message, log.actor].join(" "),
    parseItem: (log) => ActionLogSchema.parse(clone(log))
  });
}

export function buildDashboardArtifactsPage(
  artifacts: Artifact[],
  params?: DashboardCollectionPageParams
): DashboardCollectionPage<Artifact> {
  return buildDashboardRepositoryCollectionPage({
    items: artifacts,
    limit: params?.limit,
    cursor: params?.cursor,
    sort: params?.sort,
    q: params?.q,
    getId: (artifact) => artifact.id,
    getCreatedAt: (artifact) => artifact.createdAt,
    getTitle: (artifact) => artifact.title,
    getSearchText: (artifact) => [artifact.id, artifact.title, artifact.artifactType, artifact.content].join(" "),
    parseItem: (artifact) => ArtifactSchema.parse(clone(artifact))
  });
}

async function collectDashboardGoalBundles(
  repository: DashboardCollectionRepositoryPort,
  userId: string
): Promise<GoalBundle[]> {
  const bundles: GoalBundle[] = [];
  let cursor: string | null = null;

  while (bundles.length < DASHBOARD_COLLECTION_MAX_SCAN_ITEMS) {
    const remaining = DASHBOARD_COLLECTION_MAX_SCAN_ITEMS - bundles.length;
    const page = await repository.listGoalsPage({
      userId,
      limit: Math.min(DASHBOARD_COLLECTION_SCAN_PAGE_LIMIT, remaining),
      cursor
    });

    bundles.push(...page.items);

    if (!page.nextCursor || page.items.length === 0) {
      break;
    }

    cursor = page.nextCursor;
  }

  return bundles;
}

async function collectDashboardMemories(
  repository: DashboardCollectionRepositoryPort,
  userId: string
): Promise<MemoryRecord[]> {
  const memories: MemoryRecord[] = [];
  let cursor: string | null = null;

  while (memories.length < DASHBOARD_COLLECTION_MAX_SCAN_ITEMS) {
    const remaining = DASHBOARD_COLLECTION_MAX_SCAN_ITEMS - memories.length;
    const page = await repository.listMemoryPage({
      userId,
      limit: Math.min(DASHBOARD_COLLECTION_SCAN_PAGE_LIMIT, remaining),
      cursor
    });

    memories.push(...page.items);

    if (!page.nextCursor || page.items.length === 0) {
      break;
    }

    cursor = page.nextCursor;
  }

  return memories;
}

export async function listDashboardApprovalsPage(
  repository: DashboardCollectionRepositoryPort,
  params?: DashboardCollectionPageParams
): Promise<DashboardCollectionPage<ApprovalRequest>> {
  const userId = params?.userId ?? DEFAULT_OWNER_USER_ID;
  const bundles = await collectDashboardGoalBundles(repository, userId);
  const approvals = bundles.flatMap((bundle) => bundle.approvals).filter(
    (approval) =>
      (!params?.status || approval.decision === params.status) &&
      (!params?.riskClass || approval.riskClass === params.riskClass)
  );

  return buildDashboardApprovalsPage(approvals, params);
}

export async function listDashboardCommitmentsPage(
  repository: DashboardCollectionRepositoryPort,
  params?: DashboardCollectionPageParams
): Promise<DashboardCollectionPage<Commitment>> {
  const userId = params?.userId ?? DEFAULT_OWNER_USER_ID;
  const [goals, persisted] = await Promise.all([
    collectDashboardGoalBundles(repository, userId),
    repository.listCommitments(userId)
  ]);
  const approvals = goals.flatMap((bundle) => bundle.approvals);
  const bucket = params?.bucket ?? "all";
  const commitments = mergeCommitments({ goals, approvals, persisted, userId }).filter(
    (commitment) =>
      matchesDashboardCommitmentBucket(commitment, bucket) &&
      (!params?.status || commitment.status === params.status) &&
      (!params?.riskClass || commitment.riskClass === params.riskClass)
  );

  return buildDashboardCommitmentsPage(commitments, params);
}

export async function listDashboardJobsPage(
  repository: DashboardCollectionRepositoryPort,
  params?: DashboardCollectionPageParams
): Promise<DashboardCollectionPage<JobRecord>> {
  const jobs = await repository.listJobs({
    userId: params?.userId,
    kinds: params?.kinds,
    statuses: params?.statuses,
    limit: DASHBOARD_COLLECTION_MAX_SCAN_ITEMS
  });

  return buildDashboardJobsPage(jobs, params);
}

export async function listDashboardMemoryPage(
  repository: DashboardCollectionRepositoryPort,
  params?: DashboardCollectionPageParams
): Promise<DashboardCollectionPage<MemoryRecord>> {
  const memories = (await collectDashboardMemories(repository, params?.userId ?? DEFAULT_OWNER_USER_ID)).filter(
    (memory) => !params?.kind || memory.memoryType === params.kind
  );
  return buildDashboardMemoryPage(memories, params);
}

export async function listDashboardActionLogsPage(
  repository: DashboardCollectionRepositoryPort,
  params?: DashboardCollectionPageParams
): Promise<DashboardCollectionPage<ActionLog>> {
  const goals = await collectDashboardGoalBundles(repository, params?.userId ?? DEFAULT_OWNER_USER_ID);
  const logs = goals.flatMap((bundle) => bundle.actionLogs).filter((log) => !params?.kind || log.kind === params.kind);
  return buildDashboardActionLogsPage(logs, params);
}

export async function listDashboardArtifactsPage(
  repository: DashboardCollectionRepositoryPort,
  params?: DashboardCollectionPageParams
): Promise<DashboardCollectionPage<Artifact>> {
  const goals = await collectDashboardGoalBundles(repository, params?.userId ?? DEFAULT_OWNER_USER_ID);
  const artifacts = goals.flatMap((bundle) => bundle.artifacts).filter((artifact) => !params?.kind || artifact.artifactType === params.kind);
  return buildDashboardArtifactsPage(artifacts, params);
}

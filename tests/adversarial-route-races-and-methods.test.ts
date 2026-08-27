import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_OWNER_USER_ID } from "@agentic/contracts";
import { processUserRequest } from "@agentic/orchestrator";
import { createRepository } from "@agentic/repository";
import { POST as approvalResponseRoute } from "../apps/web/app/api/approvals/[id]/respond/route";
import { POST as goalsCreateRoute } from "../apps/web/app/api/goals/route";
import { POST as replayJobRoute } from "../apps/web/app/api/jobs/[id]/replay/route";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import {
  resetAuthSessionStateStoreForTesting,
  setAuthSessionStateStoreForTesting,
  type AuthSessionStateStore
} from "../apps/web/lib/auth-session-store";
import { expectNoStoreHeaders } from "./route-test-helpers";

/**
 * Adversarial concurrency + consistency coverage for Agentic route handlers, run
 * fully in-process against the SAME file-backed runtime store the existing route
 * suites build (per-test temp dir under build/, never .agentic/). These exercise
 * real double-submit races through the handler layer rather than the mocked
 * "already handled" fakes used in route-user-scope.test.ts.
 *
 * Genuine gaps vs. existing coverage (documented, not duplicated):
 *  - goal-route.test.ts proves SEQUENTIAL idempotency dedupe; here we prove the
 *    CONCURRENT double-submit cannot fork two jobs (shared mutation lock).
 *  - route-user-scope.test.ts asserts a 409 using a fake repository that always
 *    throws; here we drive TWO REAL concurrent responses to one pending approval
 *    and require exactly one 202 + one 409 with a single follow-up job.
 *  - approval-job-route.test.ts replays a dead-letter job once; here we fire two
 *    CONCURRENT replays and require a single deduped follow-up job.
 */

const TEST_ACCESS_KEY = "test-access-key";
const tempDirs: string[] = [];

function allowAllAuthStateStore(): AuthSessionStateStore {
  return {
    scope: "process-local",
    async checkRateLimit() {
      return { allowed: true, retryAfterMs: 0 };
    },
    async clearRateLimit() {},
    async revokeSession() {},
    async isSessionRevoked() {
      return false;
    },
    async reset() {}
  };
}

function authorizedJsonRequest(url: string, body: unknown, method = "POST"): Request {
  return new Request(url, {
    method,
    headers: {
      "content-type": "application/json",
      [AGENTIC_ACCESS_KEY_HEADER]: TEST_ACCESS_KEY
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

describe("adversarial route handlers: races & double-submit", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;
  const originalNodeEnv = process.env.NODE_ENV;

  async function seededRepository() {
    const repository = createRepository({ storePath: process.env.AGENTIC_RUNTIME_STORE_PATH });

    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    return repository;
  }

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = TEST_ACCESS_KEY;
    process.env.NODE_ENV = "test";

    const dir = await mkdtemp(path.join(process.cwd(), "build", "adversarial-races-"));
    tempDirs.push(dir);
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(dir, "runtime-store.json");

    Reflect.set(globalThis, "__agenticRepository", undefined);
    Reflect.set(globalThis, "__agenticSelfImprovementRepository", undefined);
    setAuthSessionStateStoreForTesting(allowAllAuthStateStore());
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    process.env.NODE_ENV = originalNodeEnv;
    Reflect.set(globalThis, "__agenticRepository", undefined);
    Reflect.set(globalThis, "__agenticSelfImprovementRepository", undefined);
    resetAuthSessionStateStoreForTesting();
  });

  afterAll(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("dedupes a concurrent double-submit of goal creation into a single job", async () => {
    const buildRequest = () =>
      authorizedJsonRequest("http://localhost/api/goals", {
        request: "Race test: prepare a single weekly planning workflow."
      });

    const [first, second] = await Promise.all([goalsCreateRoute(buildRequest()), goalsCreateRoute(buildRequest())]);
    const [firstPayload, secondPayload] = (await Promise.all([first.json(), second.json()])) as Array<{
      job: { id: string; goalId: string };
      statusUrl: string;
    }>;

    const repository = await seededRepository();
    const goalJobs = (await repository.listJobs({ userId: DEFAULT_OWNER_USER_ID })).filter(
      (job) => job.kind === "goal_create"
    );

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    // The derived idempotency key is payload-deterministic, so the loser must adopt
    // the winner's job rather than fork a second goal_create.
    expect(secondPayload.job.id).toBe(firstPayload.job.id);
    expect(secondPayload.job.goalId).toBe(firstPayload.job.goalId);
    expect(goalJobs).toHaveLength(1);
    expect(goalJobs[0]?.idempotencyKey).toMatch(/^goal-create:/);
  });

  it("allows exactly one winner when two clients respond to the same pending approval concurrently", async () => {
    const repository = await seededRepository();
    const bundle = await processUserRequest({
      userId: DEFAULT_OWNER_USER_ID,
      request: "Review my inbox and draft responses.",
      memories: await repository.listMemory(DEFAULT_OWNER_USER_ID),
      integrations: await repository.listIntegrations(DEFAULT_OWNER_USER_ID)
    });

    await repository.saveGoalBundle(bundle);

    const approval = bundle.approvals[0]!;
    expect(approval.decision).toBe("pending");

    // Reset the cached repo so the handlers read the bundle we just persisted, then
    // let both responses race through the shared mutation lock.
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const fire = (decision: "approved" | "rejected") =>
      approvalResponseRoute(
        authorizedJsonRequest(`http://localhost/api/approvals/${approval.id}/respond`, { decision }),
        { params: Promise.resolve({ id: approval.id }) }
      );

    const [first, second] = await Promise.all([fire("approved"), fire("rejected")]);
    const statuses = [first.status, second.status].sort();

    // One 202 (winner) and one 409 (loser: already handled) — never two 202s.
    expect(statuses).toEqual([202, 409]);

    const loser = first.status === 409 ? first : second;
    const loserPayload = (await loser.json()) as { error?: string };
    expect(loserPayload.error).toContain("already been handled");
    expectNoStoreHeaders(loser);

    const followUpJobs = (await repository.listJobs({ userId: DEFAULT_OWNER_USER_ID })).filter(
      (job) => job.kind === "approval_follow_up"
    );
    expect(followUpJobs).toHaveLength(1);

    const finalApproval = (await repository.getGoalBundleForUser(bundle.goal.id, DEFAULT_OWNER_USER_ID))?.approvals.find(
      (candidate) => candidate.id === approval.id
    );
    // Final persisted decision must equal the winner's submitted decision (no torn write).
    expect(finalApproval?.decision).toBe(first.status === 202 ? "approved" : "rejected");
    expect(finalApproval?.decision).not.toBe("pending");
  });

  it("dedupes concurrent replays of one dead-lettered job into a single follow-up job", async () => {
    const repository = await seededRepository();
    const bundle = await processUserRequest({
      userId: DEFAULT_OWNER_USER_ID,
      request: "Review my inbox and draft responses.",
      memories: await repository.listMemory(DEFAULT_OWNER_USER_ID),
      integrations: await repository.listIntegrations(DEFAULT_OWNER_USER_ID)
    });

    await repository.saveGoalBundle(bundle);
    const approval = bundle.approvals[0]!;

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const respond = await approvalResponseRoute(
      authorizedJsonRequest(`http://localhost/api/approvals/${approval.id}/respond`, { decision: "approved" }),
      { params: Promise.resolve({ id: approval.id }) }
    );
    const respondPayload = (await respond.json()) as { job: { id: string } };

    expect(respond.status).toBe(202);

    // Drive the follow-up job into dead_letter so it becomes replayable.
    await repository.claimNextJob({
      userId: DEFAULT_OWNER_USER_ID,
      kinds: ["approval_follow_up"],
      runnerId: "worker-adversarial-race",
      leaseMs: 30_000,
      now: "2099-01-01T00:00:00.000Z"
    });
    await repository.deadLetterJob({
      jobId: respondPayload.job.id,
      runnerId: "worker-adversarial-race",
      deadLetteredAt: "2099-01-01T00:01:00.000Z",
      error: "adversarial race induced failure"
    });

    const replayUrl = `http://localhost/api/jobs/${respondPayload.job.id}/replay`;
    const [firstReplay, secondReplay] = await Promise.all([
      replayJobRoute(authorizedJsonRequest(replayUrl, {}), {
        params: Promise.resolve({ id: respondPayload.job.id })
      }),
      replayJobRoute(authorizedJsonRequest(replayUrl, {}), {
        params: Promise.resolve({ id: respondPayload.job.id })
      })
    ]);
    const [firstReplayPayload, secondReplayPayload] = (await Promise.all([
      firstReplay.json(),
      secondReplay.json()
    ])) as Array<{ job: { id: string } }>;

    expect(firstReplay.status).toBe(202);
    expect(secondReplay.status).toBe(202);
    // Both replays derive the same idempotency key from the source job, so the
    // second must adopt the first replayed job instead of double-queueing the side effect.
    expect(secondReplayPayload.job.id).toBe(firstReplayPayload.job.id);

    const replayedJobs = (await repository.listJobs({ userId: DEFAULT_OWNER_USER_ID })).filter((job) => {
      if (job.kind !== "approval_follow_up") {
        return false;
      }

      const metadata = (job.payload as { metadata?: { replayedFromJobId?: string | null } }).metadata;

      return metadata?.replayedFromJobId === respondPayload.job.id;
    });
    expect(replayedJobs).toHaveLength(1);
  });

  it("reflects an unbounded hostile job id in the replay 404 body", async () => {
    // Sibling routes bound path ids (memory/[id] uses MemoryIdSchema max 200 and
    // truncates oversized ids out with a 400). The replay route only checks
    // `!id.trim()` and then interpolates the RAW path param into the error body,
    // so an attacker-sized id is echoed back verbatim. This pins TRUE current
    // behavior as a regression tripwire for a bounded-message fix.
    // DEFECT (LOW, information hygiene): apps/web/app/api/jobs/[id]/replay/route.ts
    //   fix: validate `id` with a bounded schema (e.g. z.string().trim().min(1).max(200))
    //   before use, and/or do not interpolate the raw id into 404/409 messages.
    const giantId = "x".repeat(5_000);
    const response = await replayJobRoute(authorizedJsonRequest(`http://localhost/api/jobs/${giantId}/replay`, {}), {
      params: Promise.resolve({ id: giantId })
    });
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(404);
    expect(payload.error).toBe(`Job ${giantId} was not found.`);
    expectNoStoreHeaders(response);
  });
});

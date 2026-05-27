import { DEFAULT_OWNER_USER_ID, WatcherSchema, createSystemActorContext, nowIso, type Watcher } from "@agentic/contracts";
import { claimWatcherLeaseWithPostgresClient } from "../packages/repository/src/watcher-lease-helpers";

function buildWatcher(overrides: Partial<Watcher> = {}): Watcher {
  const timestamp = nowIso();

  return WatcherSchema.parse({
    id: "watcher-lease-helper-1",
    goalId: "goal-lease-helper-1",
    targetEntity: "VIP inbox",
    condition: "A priority sender replies.",
    frequency: "5min",
    triggerAction: "Draft an operator-safe escalation.",
    sourceSystems: ["gmail"],
    status: "active",
    expiryAt: null,
    actorContext: createSystemActorContext(DEFAULT_OWNER_USER_ID),
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  });
}

describe("watcher lease helpers", () => {
  const staleEligibilityCases: Array<[string, Watcher]> = [
    [
      "future nextRunAt",
      buildWatcher({
        schedule: {
          enabled: true,
          dryRun: true,
          cursor: null,
          lastRunAt: "2026-04-20T00:00:00.000Z",
          nextRunAt: "2026-04-20T00:05:00.000Z",
          lease: null
        }
      })
    ],
    [
      "paused status",
      buildWatcher({
        status: "paused"
      })
    ],
    [
      "disabled schedule",
      buildWatcher({
        schedule: {
          enabled: false,
          dryRun: true,
          cursor: null,
          lastRunAt: null,
          nextRunAt: null,
          lease: null
        }
      })
    ]
  ];

  it.each(staleEligibilityCases)("does not persist a stale Postgres lease after row lock when eligibility changed: %s", async (_caseName, watcher) => {
    const queries: string[] = [];
    const client = {
      query: async (text: string) => {
        queries.push(text);

        if (text.includes("select w.*")) {
          return { rows: [watcher] };
        }

        return { rows: [] };
      }
    };

    const leased = await claimWatcherLeaseWithPostgresClient({
      client,
      userId: DEFAULT_OWNER_USER_ID,
      lease: {
        watcherId: watcher.id,
        userId: DEFAULT_OWNER_USER_ID,
        runnerId: "scheduler-2",
        acquiredAt: "2026-04-20T00:00:00.000Z",
        expiresAt: "2026-04-20T00:01:00.000Z"
      },
      mapWatcherRow: (row) => WatcherSchema.parse(row)
    });

    expect(leased).toBeNull();
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("for update of w");
  });
});

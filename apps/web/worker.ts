// Custom Cloudflare Worker entry (F3 / #980, F8 / #981).
//
// Re-uses the OpenNext-generated fetch handler and adds a scheduled() handler
// for Cloudflare Cron Triggers. The cron drives the durable worker queue by
// invoking the in-app, machine-token-gated POST /api/worker/tick route, which
// drains a bounded batch of durable jobs and (with runWatchers) runs one
// watcher-scheduler pass. Keeping that logic inside the Next/OpenNext bundle
// avoids pulling the worker-runtime + pg + node:fs graph into this entry, which
// wrangler bundles without Next's serverExternalPackages/transpile handling.

// @ts-ignore `.open-next/worker.js` is generated at build time by `cf:build`.
import { default as openNextHandler } from "./.open-next/worker.js";

type CronEnv = {
  AGENTIC_WORKER_TICK_TOKEN?: string;
  AGENTIC_WORKER_TICK_MAX_JOBS?: string;
  AGENTIC_WORKER_TICK_MAX_DURATION_MS?: string;
  [key: string]: unknown;
};

type ExecutionContextLike = {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
};

type ScheduledEventLike = {
  cron?: string;
  scheduledTime?: number;
};

type FetchHandler = (request: Request, env: unknown, ctx: ExecutionContextLike) => Promise<Response>;

const fetchHandler = (openNextHandler as { fetch: FetchHandler }).fetch;

function clampPositiveInt(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

export default {
  fetch: fetchHandler,

  async scheduled(_event: ScheduledEventLike, env: CronEnv, ctx: ExecutionContextLike): Promise<void> {
    const token = env.AGENTIC_WORKER_TICK_TOKEN?.trim();
    if (!token) {
      console.error("[cron] worker tick skipped: AGENTIC_WORKER_TICK_TOKEN is not configured");
      return;
    }

    const maxJobs = clampPositiveInt(env.AGENTIC_WORKER_TICK_MAX_JOBS, 50, 50);
    const maxDurationMs = clampPositiveInt(env.AGENTIC_WORKER_TICK_MAX_DURATION_MS, 50_000, 60_000);

    // Internal self-invocation of the in-bundle tick route. The origin is
    // irrelevant (handled in-process); the machine token authorizes the call.
    const request = new Request("https://cron.internal/api/worker/tick", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agentic-machine-token": token
      },
      body: JSON.stringify({ maxJobs, maxDurationMs, runWatchers: true })
    });

    ctx.waitUntil(
      fetchHandler(request, env, ctx)
        .then(async (response) => {
          const detail = await response.text();
          if (response.ok) {
            console.log(`[cron] worker tick ${response.status}: ${detail}`);
          } else {
            console.error(`[cron] worker tick failed ${response.status}: ${detail}`);
          }
        })
        .catch((error) => {
          console.error("[cron] worker tick threw", error);
        })
    );
  }
};

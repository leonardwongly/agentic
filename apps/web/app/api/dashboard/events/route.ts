import { requireApiSession } from "../../../../lib/auth";
import { ApiRouteError, authenticatedResponse, handleApiError, withApiTelemetry } from "../../../../lib/api-response";
import { getSeededRepository } from "../../../../lib/server";
import {
  buildDashboardEventBatch,
  buildDashboardEventSignature
} from "../../../../lib/dashboard-events";
import {
  encodeServerSentEvent,
  parseBoundedInteger,
  parseLastEventId
} from "../../../../lib/job-events";

const DEFAULT_POLL_MS = 2_500;
const DEFAULT_HEARTBEAT_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 30_000;

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiTelemetry(request, "api.dashboard.events.stream", async () => {
    try {
      const principal = await requireApiSession(request);
      const repository = await getSeededRepository();
      const url = new URL(request.url);
      const pollMs = parseBoundedInteger({
        value: url.searchParams.get("pollMs"),
        fallback: DEFAULT_POLL_MS,
        min: 500,
        max: 10_000
      });
      const heartbeatMs = parseBoundedInteger({
        value: url.searchParams.get("heartbeatMs"),
        fallback: DEFAULT_HEARTBEAT_MS,
        min: 5_000,
        max: 30_000
      });
      const timeoutMs = parseBoundedInteger({
        value: url.searchParams.get("timeoutMs"),
        fallback: DEFAULT_TIMEOUT_MS,
        min: 1_000,
        max: 60_000
      });

      if (timeoutMs < pollMs) {
        throw new ApiRouteError(400, "timeoutMs must be greater than or equal to pollMs.");
      }

      const encoder = new TextEncoder();
      let closed = false;
      let eventId = parseLastEventId(request.headers.get("last-event-id"));

      const loadBatch = async () => {
        const [dashboard, jobs] = await Promise.all([
          repository.getDashboardData(principal.userId),
          repository.listJobs({ userId: principal.userId, limit: 100 })
        ]);

        return buildDashboardEventBatch({
          dashboard,
          jobs,
          principalUserId: principal.userId,
          lastEventId: eventId,
          staleAfterMs: Math.max(pollMs * 2, 5_000),
          fallbackAfterMs: Math.max(pollMs * 4, 10_000)
        });
      };

      const stream = new ReadableStream({
        start(controller) {
          const close = () => {
            if (closed) {
              return;
            }

            closed = true;
            controller.close();
          };

          const wait = (ms: number) =>
            new Promise<void>((resolve) => {
              let timeout: ReturnType<typeof setTimeout>;

              const onAbort = () => {
                clearTimeout(timeout);
                resolve();
              };

              request.signal.addEventListener("abort", onAbort, { once: true });
              timeout = setTimeout(() => {
                request.signal.removeEventListener("abort", onAbort);
                resolve();
              }, ms);
            });

          const enqueueBatch = (batch: Awaited<ReturnType<typeof loadBatch>>) => {
            if (closed) {
              return;
            }

            const maxSequence = batch.events.at(-1)?.sequence ?? eventId + 1;
            eventId = Math.max(eventId + 1, maxSequence);
            controller.enqueue(
              encoder.encode(
                encodeServerSentEvent({
                  id: eventId,
                  event: "dashboard.events",
                  data: batch
                })
              )
            );
          };

          void (async () => {
            try {
              let batch = await loadBatch();
              let lastSignature = buildDashboardEventSignature(batch);
              enqueueBatch(batch);

              const startedAt = Date.now();
              let nextHeartbeatAt = startedAt + heartbeatMs;

              while (!closed && !request.signal.aborted && Date.now() - startedAt < timeoutMs) {
                await wait(Math.min(pollMs, Math.max(250, nextHeartbeatAt - Date.now())));

                if (closed || request.signal.aborted) {
                  break;
                }

                if (Date.now() >= nextHeartbeatAt) {
                  controller.enqueue(encoder.encode(": keepalive\n\n"));
                  nextHeartbeatAt = Date.now() + heartbeatMs;
                }

                batch = await loadBatch();
                const signature = buildDashboardEventSignature(batch);

                if (signature === lastSignature) {
                  continue;
                }

                lastSignature = signature;
                enqueueBatch(batch);
              }

              close();
            } catch (error) {
              if (!closed) {
                controller.error(error);
              }
            }
          })();

          request.signal.addEventListener("abort", close, { once: true });
        }
      });

      const response = authenticatedResponse(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no"
        }
      });

      response.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate, no-transform");
      return response;
    } catch (error) {
      return handleApiError(error, "Failed to connect to dashboard event stream.");
    }
  });
}

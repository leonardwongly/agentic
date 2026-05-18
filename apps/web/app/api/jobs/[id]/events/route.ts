import { requireApiSession } from "../../../../../lib/auth";
import { ApiRouteError, authenticatedStreamResponse, handleApiError, withApiTelemetry } from "../../../../../lib/api-response";
import {
  buildJobEventSnapshot,
  encodeServerSentEvent,
  parseBoundedInteger,
  parseLastEventId
} from "../../../../../lib/job-events";
import { getSeededRepository } from "../../../../../lib/server";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const DEFAULT_POLL_MS = 1_000;
const DEFAULT_HEARTBEAT_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 30_000;

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: RouteContext) {
  return withApiTelemetry(request, "api.jobs.events.stream", async () => {
    try {
      const principal = await requireApiSession(request);
      const { id } = await context.params;
      const jobId = id.trim();

      if (!jobId) {
        throw new ApiRouteError(400, "Job id is required.");
      }

      const repository = await getSeededRepository();
      const firstJob = await repository.getJob(jobId, principal.userId);

      if (!firstJob) {
        throw new ApiRouteError(404, `Job ${jobId} was not found.`);
      }

      const url = new URL(request.url);
      const pollMs = parseBoundedInteger({
        value: url.searchParams.get("pollMs"),
        fallback: DEFAULT_POLL_MS,
        min: 250,
        max: 5_000
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

      const encoder = new TextEncoder();
      let closed = false;
      let eventId = parseLastEventId(request.headers.get("last-event-id"));

      const stream = new ReadableStream({
        start(controller) {
          const close = () => {
            if (closed) {
              return;
            }
            closed = true;
            controller.close();
          };

          const enqueueSnapshot = async (job = firstJob): Promise<boolean> => {
            if (closed) {
              return true;
            }

            eventId += 1;
            const snapshot = buildJobEventSnapshot(job);
            controller.enqueue(
              encoder.encode(
                encodeServerSentEvent({
                  id: eventId,
                  event: "job.snapshot",
                  data: snapshot
                })
              )
            );
            return snapshot.event.terminal;
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

          void (async () => {
            try {
              let lastSignature = `${firstJob.status}:${firstJob.updatedAt}:${firstJob.attemptCount}`;
              const terminal = await enqueueSnapshot();
              if (terminal) {
                close();
                return;
              }

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

                const job = await repository.getJob(jobId, principal.userId);
                if (!job) {
                  close();
                  return;
                }

                const signature = `${job.status}:${job.updatedAt}:${job.attemptCount}`;
                if (signature === lastSignature) {
                  continue;
                }

                lastSignature = signature;
                const terminalSnapshot = await enqueueSnapshot(job);
                if (terminalSnapshot) {
                  close();
                  return;
                }
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

      return authenticatedStreamResponse(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no"
        }
      });
    } catch (error) {
      return handleApiError(error, "Failed to connect to job event stream.");
    }
  });
}

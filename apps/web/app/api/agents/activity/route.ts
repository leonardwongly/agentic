import { requireApiSession } from "../../../../lib/auth";
import { authenticatedStreamResponse, handleApiError, withApiTelemetry } from "../../../../lib/api-response";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiTelemetry(request, "api.agents.activity.stream", async () => {
    try {
      await requireApiSession(request);

      const url = new URL(request.url);
      const agentFilter = url.searchParams.get("agentId");

      const encoder = new TextEncoder();
      let closed = false;
      let keepAlive: ReturnType<typeof setInterval> | null = null;

      const stream = new ReadableStream({
        start(controller) {
          // Send initial connection message.
          const connectMsg = JSON.stringify({
            id: `evt-${Date.now()}`,
            agentId: "system",
            agentName: "System",
            kind: "agent.started",
            message: "Activity stream connected",
            details: { filter: agentFilter ?? "all" },
            progress: null,
            timestamp: new Date().toISOString()
          });

          controller.enqueue(encoder.encode(`data: ${connectMsg}\n\n`));

          // Keep-alive ping every 30 seconds.
          keepAlive = setInterval(() => {
            if (closed) {
              if (keepAlive) {
                clearInterval(keepAlive);
              }
              return;
            }
            try {
              controller.enqueue(encoder.encode(": keepalive\n\n"));
            } catch {
              if (keepAlive) {
                clearInterval(keepAlive);
              }
            }
          }, 30000);

          // Clean up on close.
          request.signal.addEventListener("abort", () => {
            closed = true;
            if (keepAlive) {
              clearInterval(keepAlive);
            }
            controller.close();
          });
        },
        cancel() {
          closed = true;
          if (keepAlive) {
            clearInterval(keepAlive);
          }
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
      return handleApiError(error, "Failed to connect to activity stream.");
    }
  });
}

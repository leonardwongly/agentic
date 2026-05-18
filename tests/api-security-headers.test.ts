import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  ApiRouteError,
  authenticatedJson,
  authenticatedResponse,
  authenticatedStreamResponse,
  handleApiError,
  handleOperationalApiError,
  operationalJson,
  parseJsonBody,
  withApiTelemetry
} from "../apps/web/lib/api-response";
import { GET as agentActivityRoute } from "../apps/web/app/api/agents/activity/route";
import {
  buildAuthorizedGetRequest,
  expectAuthenticatedStreamHeaders,
  expectBaseSecurityHeaders,
  expectNoStoreHeaders,
  expectOperationalNoStoreHeaders
} from "./route-test-helpers";

async function listRouteFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        return listRouteFiles(absolutePath);
      }

      return entry.name === "route.ts" ? [absolutePath] : [];
    })
  );

  return files.flat();
}

describe("api security headers", () => {
  it("applies baseline security headers to authenticated 2xx, 4xx, and 5xx JSON responses", () => {
    const success = authenticatedJson({ ok: true });
    const validationFailure = handleApiError(new ApiRouteError(400, "Bad request."), "Fallback error.");
    const serverFailure = handleApiError(new Error("boom"), "Fallback error.");

    expect(success.status).toBe(200);
    expectNoStoreHeaders(success);
    expect(validationFailure.status).toBe(400);
    expectNoStoreHeaders(validationFailure);
    expect(serverFailure.status).toBe(500);
    expectNoStoreHeaders(serverFailure);
  });

  it("applies baseline security headers to operational 2xx, 4xx, and 5xx JSON responses", () => {
    const success = operationalJson({ ok: true });
    const validationFailure = handleOperationalApiError(new ApiRouteError(400, "Bad request."), "Fallback error.");
    const serverFailure = handleOperationalApiError(new Error("boom"), "Fallback error.");

    expect(success.status).toBe(200);
    expectOperationalNoStoreHeaders(success);
    expect(validationFailure.status).toBe(400);
    expectOperationalNoStoreHeaders(validationFailure);
    expect(serverFailure.status).toBe(500);
    expectOperationalNoStoreHeaders(serverFailure);
  });

  it("applies baseline security headers to authenticated file responses while preserving attachment metadata", () => {
    const response = authenticatedResponse("{}", {
      headers: {
        "content-type": "application/json",
        "content-disposition": "attachment; filename=\"export.json\""
      }
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toBe("attachment; filename=\"export.json\"");
    expectNoStoreHeaders(response);
  });

  it("applies authenticated no-store headers to SSE stream responses", () => {
    const response = authenticatedStreamResponse("event: ready\n\n", {
      headers: {
        "Content-Type": "text/event-stream",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      }
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("connection")).toBe("keep-alive");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expectAuthenticatedStreamHeaders(response);
  });

  it("rejects oversized JSON request bodies before parsing", async () => {
    const body = JSON.stringify({ value: "abcdef" });
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body
    });

    await expect(parseJsonBody(request, z.object({ value: z.string() }), { maxBytes: body.length - 1 })).rejects.toMatchObject({
      status: 413,
      message: "Request body is too large."
    });
  });

  it("finalizes raw telemetry responses with baseline security headers", async () => {
    const response = await withApiTelemetry(
      new Request("http://localhost/api/agents/activity"),
      "api.test.stream",
      () =>
        new Response("event: ready\n\n", {
          status: 202,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform"
          }
        })
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expectBaseSecurityHeaders(response);
  });

  it("keeps API route JSON responses on the centralized response helpers", async () => {
    const routeFiles = await listRouteFiles(path.join(process.cwd(), "apps/web/app/api"));
    const directJsonRoutes: string[] = [];
    const directResponseRoutes: string[] = [];
    const documentedRawResponseAllowlist = new Set<string>();

    for (const routeFile of routeFiles) {
      const source = await readFile(routeFile, "utf8");

      if (source.includes("NextResponse.json(")) {
        directJsonRoutes.push(path.relative(process.cwd(), routeFile));
      }

      if (source.includes("new Response(") && !documentedRawResponseAllowlist.has(routeFile)) {
        directResponseRoutes.push(path.relative(process.cwd(), routeFile));
      }
    }

    expect(directJsonRoutes).toEqual([]);
    expect(directResponseRoutes).toEqual([]);
  });

  it("applies authenticated stream headers to the agent activity SSE route", async () => {
    const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";

    let response: Response | undefined;
    try {
      response = await agentActivityRoute(buildAuthorizedGetRequest("http://localhost/api/agents/activity"));
    } finally {
      process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    }

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expectAuthenticatedStreamHeaders(response);

    await response.body?.cancel();
  });
});

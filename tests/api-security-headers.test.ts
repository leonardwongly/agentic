import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ApiRouteError, authenticatedJson, handleApiError, withApiTelemetry } from "../apps/web/lib/api-response";
import { expectBaseSecurityHeaders, expectNoStoreHeaders } from "./route-test-helpers";

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
  it("applies baseline security headers to successful authenticated JSON responses", () => {
    const response = authenticatedJson({ ok: true });

    expect(response.status).toBe(200);
    expectNoStoreHeaders(response);
    expectBaseSecurityHeaders(response);
  });

  it("applies baseline security headers to validation and server error responses", () => {
    const validationResponse = handleApiError(new ApiRouteError(400, "Invalid request."), "Fallback.");
    const serverResponse = handleApiError(new Error("secret failure detail"), "Internal server error.");

    expect(validationResponse.status).toBe(400);
    expectBaseSecurityHeaders(validationResponse);
    expectNoStoreHeaders(validationResponse);

    expect(serverResponse.status).toBe(500);
    expectBaseSecurityHeaders(serverResponse);
    expectNoStoreHeaders(serverResponse);
  });

  it("finalizes raw telemetry responses with baseline security headers", async () => {
    const response = await withApiTelemetry(
      new Request("http://localhost/api/agents/activity"),
      "api.test.stream",
      () =>
        new Response("event: ready\n\n", {
          status: 202,
          headers: {
            "Content-Type": "text/event-stream"
          }
        })
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expectBaseSecurityHeaders(response);
  });

  it("keeps API route JSON responses on the centralized response helpers", async () => {
    const routeFiles = await listRouteFiles(path.join(process.cwd(), "apps/web/app/api"));
    const directJsonRoutes: string[] = [];
    const directResponseRoutes: string[] = [];
    const documentedRawResponseAllowlist = new Set([
      path.join(process.cwd(), "apps/web/app/api/agents/activity/route.ts")
    ]);

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
});

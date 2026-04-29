import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ApiRouteError,
  authenticatedJson,
  authenticatedResponse,
  handleApiError,
  handleOperationalApiError,
  operationalJson,
  withApiTelemetry
} from "../apps/web/lib/api-response";
import { expectNoStoreHeaders, expectOperationalNoStoreHeaders } from "./route-test-helpers";

const API_ROUTE_ROOT = "apps/web/app/api";
const RAW_RESPONSE_EXCEPTION_FILES = new Set(["apps/web/app/api/agents/activity/route.ts"]);

function listRouteFiles(directory: string): string[] {
  return readdirSync(path.resolve(process.cwd(), directory), { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return listRouteFiles(relativePath);
    }

    return entry.isFile() && entry.name === "route.ts" ? [relativePath] : [];
  });
}

describe("api security headers", () => {
  it("applies base security headers to authenticated 2xx, 4xx, and 5xx JSON responses", () => {
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

  it("applies base security headers to operational 2xx, 4xx, and 5xx JSON responses", () => {
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

  it("applies base security headers to authenticated file responses while preserving attachment metadata", () => {
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

  it("applies base security headers to telemetry-wrapped streaming exceptions", async () => {
    const response = await withApiTelemetry(
      new Request("http://localhost/api/agents/activity"),
      "api.agents.activity.stream",
      () =>
        new Response("data: {}\n\n", {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache, no-transform"
          }
        })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  it("keeps direct API response construction limited to documented exceptions", () => {
    const violations = listRouteFiles(API_ROUTE_ROOT).flatMap((filePath) => {
      if (RAW_RESPONSE_EXCEPTION_FILES.has(filePath)) {
        const content = readFileSync(path.resolve(process.cwd(), filePath), "utf8");
        return content.includes("AOS-07 security-header exception") ? [] : [`${filePath}: missing AOS-07 exception note`];
      }

      const content = readFileSync(path.resolve(process.cwd(), filePath), "utf8");
      const forbiddenPatterns = [
        { name: "NextResponse.json", pattern: /\bNextResponse\.json\s*\(/u },
        { name: "Response.json", pattern: /\bResponse\.json\s*\(/u },
        { name: "new Response", pattern: /\bnew\s+Response\s*\(/u }
      ];

      return forbiddenPatterns
        .filter(({ pattern }) => pattern.test(content))
        .map(({ name }) => `${filePath}: replace ${name} with api-response helpers or document an exception`);
    });

    expect(violations).toEqual([]);
  });
});

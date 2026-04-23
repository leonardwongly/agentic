import { createRepository, type AgenticRepository } from "@agentic/repository";
import { expect } from "vitest";
import { AGENTIC_ACCESS_KEY_HEADER, AGENTIC_SESSION_COOKIE, buildSessionToken } from "../apps/web/lib/auth";
import { AUTHENTICATED_API_CACHE_CONTROL, OPERATIONAL_API_CACHE_CONTROL } from "../apps/web/lib/api-response";

export function createRouteTestRepository(): AgenticRepository {
  return createRepository({
    storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
  });
}

export function buildAuthorizedJsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
    },
    body: JSON.stringify(body)
  });
}

export function buildAuthorizedGetRequest(url: string): Request {
  return new Request(url, {
    method: "GET",
    headers: {
      [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
    }
  });
}

export function buildSessionJsonRequest(url: string, body: unknown, userId: string): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${AGENTIC_SESSION_COOKIE}=${buildSessionToken(userId)}`
    },
    body: JSON.stringify(body)
  });
}

export function buildSessionGetRequest(url: string, userId: string): Request {
  return new Request(url, {
    method: "GET",
    headers: {
      cookie: `${AGENTIC_SESSION_COOKIE}=${buildSessionToken(userId)}`
    }
  });
}

export function buildInvalidJsonRequest(url: string): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
    },
    body: "{"
  });
}

export function expectNoStoreHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe(AUTHENTICATED_API_CACHE_CONTROL);
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("expires")).toBe("0");
  expect(response.headers.get("vary")).toContain("Cookie");
  expect(response.headers.get("vary")).toContain("X-Agentic-Access-Key");
}

export function expectOperationalNoStoreHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe(OPERATIONAL_API_CACHE_CONTROL);
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("expires")).toBe("0");
  expect(response.headers.get("vary")).toBeNull();
}

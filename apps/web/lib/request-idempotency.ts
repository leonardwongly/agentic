import crypto from "node:crypto";
import { ApiRouteError } from "./api-response";

export const IDEMPOTENCY_KEY_HEADER = "x-idempotency-key";

export function parseIdempotencyKey(request: Request): string | null {
  const candidate = request.headers.get(IDEMPOTENCY_KEY_HEADER)?.trim() ?? "";

  if (!candidate) {
    return null;
  }

  if (!/^[A-Za-z0-9:_-]{1,200}$/u.test(candidate)) {
    throw new ApiRouteError(400, `${IDEMPOTENCY_KEY_HEADER} must be 1-200 URL-safe characters.`);
  }

  return candidate;
}

/**
 * Locale-free key ordering. `String.prototype.localeCompare` uses ICU collation, which
 * reports canonically-equivalent unicode keys ("\u00e9" vs "e\u0301") as equal; a stable sort
 * then keeps the caller's insertion order, so the same logical payload can serialise two
 * ways and a retry derives a different key. Code-unit comparison is a total order.
 */
function compareCanonicalKeys(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function isPlainObject(value: object): boolean {
  const prototype = Reflect.getPrototypeOf(value) as unknown;

  return prototype === Object.prototype || prototype === null;
}

function constructorTag(value: object): string {
  const name = (value as { constructor?: { name?: unknown } }).constructor?.name;

  return typeof name === "string" && name.length > 0 ? name : "object";
}

function serialiseDate(value: Date): string {
  let iso: string;

  try {
    iso = value.toISOString();
  } catch {
    iso = "Invalid Date";
  }

  return `{"$type":"Date","value":${JSON.stringify(iso)}}`;
}

/**
 * Canonical JSON used as the idempotency-key pre-image.
 *
 * Every value shape must map to exactly one serialisation: plain objects sort their keys,
 * and non-plain objects (Date / Map / Set / class instances) carry an explicit type tag so
 * they can never collapse to `{}` and share a key with an unrelated payload.
 */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }

  if (value instanceof Date) {
    return serialiseDate(value);
  }

  if (value instanceof Map) {
    const entries = [...value.entries()]
      .map(([key, item]) => `[${stableJson(key)},${stableJson(item)}]`)
      .sort(compareCanonicalKeys);

    return `{"$type":"Map","value":[${entries.join(",")}]}`;
  }

  if (value instanceof Set) {
    const items = [...value].map((item) => stableJson(item)).sort(compareCanonicalKeys);

    return `{"$type":"Set","value":[${items.join(",")}]}`;
  }

  if (value && typeof value === "object") {
    const body = `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareCanonicalKeys(left, right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;

    return isPlainObject(value) ? body : `{"$type":${JSON.stringify(constructorTag(value))},"value":${body}}`;
  }

  return JSON.stringify(value);
}

export function deriveIdempotencyKey(params: {
  namespace: string;
  userId: string;
  method: string;
  pathname: string;
  payload: unknown;
}): string {
  if (!/^[A-Za-z0-9:_-]{1,80}$/u.test(params.namespace)) {
    throw new ApiRouteError(500, "Invalid idempotency namespace.");
  }

  const digest = crypto
    .createHash("sha256")
    .update(stableJson({
      method: params.method.toUpperCase(),
      pathname: params.pathname,
      payload: params.payload,
      userId: params.userId
    }))
    .digest("base64url")
    .slice(0, 32);

  return `${params.namespace}:${digest}`;
}

export function parseOrDeriveIdempotencyKey(request: Request, params: {
  namespace: string;
  userId: string;
  payload: unknown;
}): string {
  const supplied = parseIdempotencyKey(request);

  if (supplied) {
    return supplied;
  }

  const url = new URL(request.url);
  return deriveIdempotencyKey({
    namespace: params.namespace,
    userId: params.userId,
    method: request.method,
    pathname: url.pathname,
    payload: params.payload
  });
}

import { z } from "zod";

export function requireJsonContentType(request: Request): void {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    throw Object.assign(new Error("Request Content-Type must be application/json."), { name: "ContentTypeError" });
  }
}

export function isContentTypeError(error: unknown): error is Error {
  return error instanceof Error && error.name === "ContentTypeError";
}

function formatIssuePath(path: PropertyKey[]): string {
  const label = path.map((segment) => String(segment)).join(".").trim();
  return label.length > 0 ? label : "request";
}

export function formatValidationError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = formatIssuePath(issue.path);

      if (issue.code === "too_big" && issue.origin === "string") {
        return `${path} must be at most ${issue.maximum} characters.`;
      }

      if (issue.code === "too_small" && issue.origin === "string") {
        return `${path} must be at least ${issue.minimum} characters.`;
      }

      if (issue.code === "invalid_type") {
        return `${path} has an invalid type.`;
      }

      return issue.message;
    })
    .join(" ");
}

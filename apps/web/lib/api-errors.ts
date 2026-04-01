import { z } from "zod";

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

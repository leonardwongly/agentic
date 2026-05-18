import { LocalNoteNotFoundError, LocalNotesConfigurationError } from "@agentic/integrations";
import { ApiRouteError } from "../../../../lib/api-response";

export function normalizeLocalNotesRouteError(error: unknown): unknown {
  if (error instanceof LocalNotesConfigurationError) {
    return new ApiRouteError(403, error.message);
  }

  if (error instanceof LocalNoteNotFoundError) {
    return new ApiRouteError(404, error.message);
  }

  return error;
}

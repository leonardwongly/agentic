import {
  createHumanActorContext,
  createSystemActorContext,
  type ActorContext
} from "@agentic/contracts";
import type { AuthPrincipal } from "./auth";

export function createActorContextFromPrincipal(principal: AuthPrincipal): ActorContext {
  if (principal.authMethod === "session") {
    return createHumanActorContext(principal.userId, principal.sessionId);
  }

  return createSystemActorContext(principal.userId, principal.sessionId);
}

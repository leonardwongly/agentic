import {
  buildSystemActorIdentity,
  createActorContext,
  createHumanActorContext,
  createSystemActorContext,
  type ActorContext
} from "@agentic/contracts";
import type { AuthPrincipal } from "./auth";

export function createActorContextFromPrincipal(principal: AuthPrincipal): ActorContext {
  if (principal.authMethod === "session") {
    return createHumanActorContext(principal.userId, principal.sessionId);
  }

  if (principal.authMethod === "machine_token") {
    return createActorContext({
      subjectUserId: principal.userId,
      initiator: buildSystemActorIdentity({
        userId: principal.userId,
        label: `machine:${principal.tokenId}`
      }),
      sessionId: null
    });
  }

  return createSystemActorContext(principal.userId, principal.sessionId);
}

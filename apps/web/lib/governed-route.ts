import { z } from "zod";
import { checkAbuseRateLimit } from "./abuse-rate-limit";
import { createActorContextFromPrincipal } from "./actor-context";
import { type AuthPrincipal, requireApiSession } from "./auth";
import {
  ApiRouteError,
  authenticatedRateLimitError,
  handleApiError,
  parseJsonBody,
  withApiTelemetry
} from "./api-response";
import { requireJsonContentType } from "./api-errors";
import { parseIdempotencyKey } from "./request-idempotency";

type GovernedRouteRateLimitOptions = {
  namespace: string;
  error?: string;
};

type GovernedRouteIdempotencyMode = false | "optional" | "required";

export type GovernedMutationContext<TBody, TRouteContext> = {
  request: Request;
  routeContext: TRouteContext;
  principal: AuthPrincipal;
  actorContext: ReturnType<typeof createActorContextFromPrincipal>;
  body: TBody;
  idempotencyKey: string | null;
};

export type GovernedMutationRouteOptions<TBody> = {
  route: string;
  fallbackError: string;
  bodySchema?: z.ZodType<TBody>;
  requireJson?: boolean;
  rateLimit?: GovernedRouteRateLimitOptions;
  idempotency?: GovernedRouteIdempotencyMode;
};

export function createGovernedMutationRoute<TBody = undefined, TRouteContext = unknown>(
  options: GovernedMutationRouteOptions<TBody>,
  handler: (context: GovernedMutationContext<TBody, TRouteContext>) => Promise<Response> | Response
) {
  return async function governedMutationRoute(request: Request, routeContext?: TRouteContext): Promise<Response> {
    return withApiTelemetry(request, options.route, async () => {
      try {
        const principal = await requireApiSession(request);
        const actorContext = createActorContextFromPrincipal(principal);

        if (options.rateLimit) {
          const rateLimit = await checkAbuseRateLimit({
            namespace: options.rateLimit.namespace,
            request,
            principal
          });

          if (!rateLimit.allowed) {
            return authenticatedRateLimitError(
              options.rateLimit.error ?? "Too many requests. Try again later.",
              rateLimit.retryAfterSeconds
            );
          }
        }

        if (options.bodySchema || options.requireJson) {
          requireJsonContentType(request);
        }

        const body = options.bodySchema ? await parseJsonBody(request, options.bodySchema) : (undefined as TBody);
        const idempotencyMode = options.idempotency ?? false;
        const idempotencyKey = idempotencyMode === false ? null : parseIdempotencyKey(request);

        if (idempotencyMode === "required" && !idempotencyKey) {
          throw new ApiRouteError(400, "x-idempotency-key is required for this mutation.");
        }

        return await handler({
          request,
          routeContext: routeContext as TRouteContext,
          principal,
          actorContext,
          body,
          idempotencyKey
        });
      } catch (error) {
        return handleApiError(error, options.fallbackError);
      }
    });
  };
}

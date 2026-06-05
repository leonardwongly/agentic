import { z } from "zod";
import { checkAbuseRateLimit } from "./abuse-rate-limit";
import { createActorContextFromPrincipal } from "./actor-context";
import { type AuthPrincipal, requireApiPrincipal } from "./auth";
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

type GovernedMutationRouteBaseOptions = {
  route: string;
  fallbackError: string;
  requireJson?: boolean;
  rateLimit?: GovernedRouteRateLimitOptions;
  idempotency?: GovernedRouteIdempotencyMode;
  machineRouteGroup?: string;
  machineScope?: string;
  allowBootstrapAccessKey?: boolean;
};

type GovernedMutationHandler<TBody, TRouteContext> = (
  context: GovernedMutationContext<TBody, TRouteContext>
) => Promise<Response> | Response;

type GovernedMutationRoute<TRouteContext> = [TRouteContext] extends [undefined]
  ? (request: Request, routeContext?: unknown) => Promise<Response>
  : (request: Request, routeContext: TRouteContext) => Promise<Response>;

type GovernedMutationRouteImplementationOptions<TBody> =
  | GovernedMutationRouteOptions<TBody>
  | GovernedMutationNoBodyRouteOptions;

export type GovernedMutationContext<TBody = undefined, TRouteContext = undefined> = {
  request: Request;
  routeContext: TRouteContext;
  principal: AuthPrincipal;
  actorContext: ReturnType<typeof createActorContextFromPrincipal>;
  body: TBody;
  idempotencyKey: string | null;
};

type GovernedMutationNoBodyRouteOptions = GovernedMutationRouteBaseOptions & {
  bodySchema?: never;
};

export type GovernedMutationRouteOptions<TBody> = GovernedMutationRouteBaseOptions & {
  bodySchema: z.ZodType<TBody>;
};

export function createGovernedMutationRoute<TBody, TRouteContext = undefined>(
  options: GovernedMutationRouteOptions<TBody>,
  handler: GovernedMutationHandler<TBody, TRouteContext>
): GovernedMutationRoute<TRouteContext>;

export function createGovernedMutationRoute<TBody extends undefined = undefined, TRouteContext = undefined>(
  options: GovernedMutationNoBodyRouteOptions,
  handler: GovernedMutationHandler<undefined, TRouteContext>
): GovernedMutationRoute<TRouteContext>;

export function createGovernedMutationRoute<TBody = undefined, TRouteContext = undefined>(
  options: GovernedMutationRouteImplementationOptions<TBody>,
  handler: GovernedMutationHandler<TBody | undefined, TRouteContext>
): GovernedMutationRoute<TRouteContext> {
  const governedMutationRoute = async (request: Request, routeContext: TRouteContext): Promise<Response> => {
    return withApiTelemetry(request, options.route, async () => {
      try {
        const principal = await requireApiPrincipal(request, {
          allowMachineToken: Boolean(options.machineRouteGroup),
          routeGroup: options.machineRouteGroup,
          scope: options.machineScope,
          allowBootstrapAccessKey: options.allowBootstrapAccessKey
        });
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

        const body = hasGovernedMutationBodySchema(options)
          ? await parseJsonBody(request, options.bodySchema)
          : undefined;
        const idempotencyMode = options.idempotency ?? false;
        const idempotencyKey = idempotencyMode === false ? null : parseIdempotencyKey(request);

        if (idempotencyMode === "required" && !idempotencyKey) {
          throw new ApiRouteError(400, "x-idempotency-key is required for this mutation.");
        }

        return await handler({
          request,
          routeContext,
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

  return governedMutationRoute as GovernedMutationRoute<TRouteContext>;
}

function hasGovernedMutationBodySchema<TBody>(
  options: GovernedMutationRouteImplementationOptions<TBody>
): options is GovernedMutationRouteOptions<TBody> {
  return options.bodySchema !== undefined;
}

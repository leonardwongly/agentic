import { z } from "zod";
import { nowIso } from "@agentic/contracts";
import { requireApiSession } from "../../../lib/auth";
import { createActorContextFromPrincipal } from "../../../lib/actor-context";
import { authenticatedJson, handleApiError, parseJsonBody } from "../../../lib/api-response";
import { getSeededRepository } from "../../../lib/server";

const SelectOperatorProductSchema = z
  .object({
    operatorProductId: z.string().trim().min(1).max(120)
  })
  .strict();

async function buildOperatorProductPayload(userId: string) {
  const repository = await getSeededRepository();
  const [products, selection, agents, templates] = await Promise.all([
    repository.listOperatorProducts(userId),
    repository.getOperatorProductSelection(userId),
    repository.listAgents(userId),
    repository.listTemplates(userId)
  ]);

  return {
    products,
    selection,
    agents,
    templates
  };
}

export async function GET(request: Request) {
  try {
    const principal = await requireApiSession(request);
    return authenticatedJson(await buildOperatorProductPayload(principal.userId));
  } catch (error) {
    return handleApiError(error, "Failed to load operator products.");
  }
}

export async function POST(request: Request) {
  try {
    const principal = await requireApiSession(request);
    const body = await parseJsonBody(request, SelectOperatorProductSchema);
    const repository = await getSeededRepository();
    const actorContext = createActorContextFromPrincipal(principal);
    const products = await repository.listOperatorProducts(principal.userId);
    const selectedProduct = products.find((product) => product.id === body.operatorProductId);

    if (!selectedProduct) {
      return authenticatedJson(
        {
          error: `Operator product ${body.operatorProductId} was not found.`
        },
        { status: 404 }
      );
    }

    const existingSelection = await repository.getOperatorProductSelection(principal.userId);
    const timestamp = nowIso();
    const selection = await repository.saveOperatorProductSelection({
      userId: principal.userId,
      operatorProductId: selectedProduct.id,
      actorContext,
      selectedAt:
        existingSelection?.operatorProductId === selectedProduct.id ? existingSelection.selectedAt : timestamp,
      updatedAt: timestamp
    });

    const [agents, templates] = await Promise.all([
      repository.listAgents(principal.userId),
      repository.listTemplates(principal.userId)
    ]);

    return authenticatedJson({
      products,
      selection,
      agents,
      templates
    });
  } catch (error) {
    return handleApiError(error, "Failed to select operator product.");
  }
}

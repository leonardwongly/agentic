import { SYSTEM_USER_ID } from "@agentic/contracts";
import { requireApiSession } from "../../../../lib/auth";
import { authenticatedJson, handleApiError } from "../../../../lib/api-response";
import { getSeededRepository, runDocsBuild } from "../../../../lib/server";

export async function POST(request: Request) {
  try {
    await requireApiSession(request);
    const [result, repository] = await Promise.all([runDocsBuild(), getSeededRepository()]);

    return authenticatedJson({
      result,
      dashboard: await repository.getDashboardData(SYSTEM_USER_ID)
    });
  } catch (error) {
    return handleApiError(error, "Failed to render the document.");
  }
}

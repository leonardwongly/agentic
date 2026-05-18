import { unstable_noStore as noStore } from "next/cache";
import { listLocalNotes, LocalNotesConfigurationError } from "@agentic/integrations";
import { AuthGate } from "../components/auth-gate";
import { Dashboard } from "../components/dashboard";
import { getAuthMode, hasActiveSession } from "../lib/auth";
import { getSeededRepository } from "../lib/server";

export const dynamic = "force-dynamic";

async function listConfiguredLocalNotes() {
  try {
    return await listLocalNotes();
  } catch (error) {
    if (error instanceof LocalNotesConfigurationError) {
      return [];
    }

    throw error;
  }
}

export default async function HomePage() {
  noStore();

  const authenticated = await hasActiveSession();

  if (!authenticated) {
    return <AuthGate authMode={getAuthMode()} />;
  }

  const repository = await getSeededRepository();
  const [dashboard, notes, commitmentInbox] = await Promise.all([
    repository.getDashboardData(),
    listConfiguredLocalNotes(),
    repository.listCommitmentInbox()
  ]);

  return <Dashboard initialData={dashboard} initialNotes={notes} initialCommitmentInbox={commitmentInbox} />;
}

import { unstable_noStore as noStore } from "next/cache";
import { listLocalNotes } from "@agentic/integrations";
import { AuthGate } from "../components/auth-gate";
import { Dashboard } from "../components/dashboard";
import { getAuthMode, hasActiveSession } from "../lib/auth";
import { getSeededRepository } from "../lib/server";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  noStore();

  const authenticated = await hasActiveSession();

  if (!authenticated) {
    return <AuthGate authMode={getAuthMode()} />;
  }

  const repository = await getSeededRepository();
  const [dashboard, notes, commitmentInbox] = await Promise.all([
    repository.getDashboardData(),
    listLocalNotes(),
    repository.listCommitmentInbox()
  ]);

  return <Dashboard initialData={dashboard} initialNotes={notes} initialCommitmentInbox={commitmentInbox} />;
}

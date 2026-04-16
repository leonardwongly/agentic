import type { ActorContext } from "@agentic/contracts";
import type { CapturedMemories } from "@agentic/orchestrator";
import type { AgenticRepository } from "@agentic/repository";
import { getSeededSelfImprovementRepository } from "./server";

export async function persistCapturedMemories(params: {
  repository: AgenticRepository;
  captured: CapturedMemories;
  goalId: string;
  label: string;
  actorContext?: ActorContext | null;
}) {
  const { repository, captured, goalId, label, actorContext = null } = params;
  if (captured.memories.length === 0 && captured.episodes.length === 0) {
    return {
      memories: [],
      episodes: []
    };
  }

  const persistedMemories = captured.memories.map((memory) =>
    memory.actorContext || actorContext === null
      ? memory
      : {
          ...memory,
          actorContext
        }
  );
  const selfImprovement = await getSeededSelfImprovementRepository();

  await Promise.all([
    ...persistedMemories.map((memory) => repository.saveMemory(memory)),
    ...captured.episodes.map((episode) => selfImprovement.appendEpisode(episode))
  ]);

  console.log(
    `[${label}] Goal "${goalId}" persisted ${persistedMemories.length} memory record(s) and ${captured.episodes.length} episode(s).`
  );

  return {
    memories: persistedMemories,
    episodes: captured.episodes
  };
}

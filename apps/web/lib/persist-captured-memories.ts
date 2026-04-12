import type { CapturedMemories } from "@agentic/orchestrator";
import type { AgenticRepository } from "@agentic/repository";
import { getSeededSelfImprovementRepository } from "./server";

export async function persistCapturedMemories(params: {
  repository: AgenticRepository;
  captured: CapturedMemories;
  goalId: string;
  label: string;
}) {
  const { repository, captured, goalId, label } = params;
  if (captured.memories.length === 0 && captured.episodes.length === 0) {
    return {
      memories: [],
      episodes: []
    };
  }

  const selfImprovement = await getSeededSelfImprovementRepository();

  await Promise.all([
    ...captured.memories.map((memory) => repository.saveMemory(memory)),
    ...captured.episodes.map((episode) => selfImprovement.appendEpisode(episode))
  ]);

  console.log(
    `[${label}] Goal "${goalId}" persisted ${captured.memories.length} memory record(s) and ${captured.episodes.length} episode(s).`
  );

  return {
    memories: captured.memories,
    episodes: captured.episodes
  };
}

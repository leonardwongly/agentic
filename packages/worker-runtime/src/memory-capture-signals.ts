import { logError } from "@agentic/integrations";
import type { CapturedMemories } from "@agentic/orchestrator";
import type { MemoryRepositoryPort } from "@agentic/repository";
import {
  assertEpisodeLearningPrivacyPreflight,
  SelfImprovementConflictError,
  type SelfImprovementRepository
} from "@agentic/self-improvement-memory";

export async function persistCapturedSignals(params: {
  repository: MemoryRepositoryPort;
  selfImprovementRepository: SelfImprovementRepository;
  captured: CapturedMemories;
  userId: string;
  jobId: string;
  label: string;
  workspaceId?: string | null;
}) {
  if (params.captured.memories.length === 0 && params.captured.episodes.length === 0) {
    return [];
  }

  try {
    await Promise.all(params.captured.memories.map((memory) => params.repository.saveMemory(memory)));

    for (const episode of params.captured.episodes) {
      try {
        assertEpisodeLearningPrivacyPreflight(episode, {
          userId: params.userId,
          workspaceId: params.workspaceId ?? null
        });
        await params.selfImprovementRepository.appendEpisode(episode);
      } catch (error) {
        if (error instanceof SelfImprovementConflictError) {
          continue;
        }

        throw error;
      }
    }

    return params.captured.memories.map((memory) => memory.id);
  } catch (error) {
    logError("approval_follow_up.memory_capture_failed", error, {
      jobId: params.jobId,
      userId: params.userId,
      label: params.label
    });
    return [];
  }
}

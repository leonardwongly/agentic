import {
  ExecutionProvenanceGraphSchema,
  type ActionLog,
  type Artifact,
  type EvidenceRecord,
  type ExecutionProvenanceEdge,
  type ExecutionProvenanceEdgeType,
  type ExecutionProvenanceGraph,
  type ExecutionProvenanceNode,
  type ExecutionProvenanceNodeType,
  type GoalBundle,
  type JobPayload,
  type JobRecord,
  type MemoryRecord,
  type Task
} from "@agentic/contracts";
import { buildContextPacketFromMemory } from "@agentic/memory";

export type BuildExecutionProvenanceGraphParams = {
  userId: string;
  goals: GoalBundle[];
  jobs: JobRecord[];
  memories: MemoryRecord[];
  evidenceRecords?: EvidenceRecord[];
  rootId?: string | null;
  depth?: number;
  limit?: number;
};

function truncate(value: string, max = 500): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function nodeId(type: ExecutionProvenanceNodeType, id: string): string {
  return `${type}:${id}`;
}

function edgeId(type: ExecutionProvenanceEdgeType, from: string, to: string): string {
  return `${type}:${from}->${to}`;
}

function putNode(nodes: Map<string, ExecutionProvenanceNode>, node: ExecutionProvenanceNode): void {
  if (!nodes.has(node.id)) {
    nodes.set(node.id, node);
  }
}

function putEdge(edges: Map<string, ExecutionProvenanceEdge>, edge: ExecutionProvenanceEdge): void {
  if (!edges.has(edge.id)) {
    edges.set(edge.id, edge);
  }
}

function goalIdFromPayload(payload: JobPayload): string | null {
  return "goalId" in payload && typeof payload.goalId === "string" ? payload.goalId : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function contextMemoryIdsFromAction(action: ActionLog): string[] {
  const details = isRecord(action.details) ? action.details : null;
  const contextPack = isRecord(details?.contextPack) ? details.contextPack : null;

  if (!contextPack) {
    return [];
  }

  return [
    ...readStringArray(contextPack.selectedMemoryIds),
    ...readStringArray(contextPack.staleMemoryIds),
    ...readStringArray(contextPack.reviewRequiredMemoryIds),
    ...readStringArray(contextPack.conflictingMemoryIds)
  ];
}

function buildNode(params: {
  id: string;
  type: ExecutionProvenanceNodeType;
  ownerUserId: string;
  label: string;
  summary: string;
  sensitivity?: string;
  createdAt?: string | null;
  metadata?: Record<string, unknown>;
}): ExecutionProvenanceNode {
  return {
    id: params.id,
    type: params.type,
    ownerUserId: params.ownerUserId,
    label: truncate(params.label, 160),
    summary: truncate(params.summary),
    sensitivity: params.sensitivity ?? "internal",
    createdAt: params.createdAt ?? null,
    metadata: params.metadata ?? {}
  };
}

function buildEdge(params: {
  type: ExecutionProvenanceEdgeType;
  from: string;
  to: string;
  label: string;
  createdAt?: string | null;
  metadata?: Record<string, unknown>;
}): ExecutionProvenanceEdge {
  return {
    id: edgeId(params.type, params.from, params.to),
    type: params.type,
    from: params.from,
    to: params.to,
    label: truncate(params.label, 160),
    createdAt: params.createdAt ?? null,
    metadata: params.metadata ?? {}
  };
}

function addGoalBundle(
  params: BuildExecutionProvenanceGraphParams,
  bundle: GoalBundle,
  nodes: Map<string, ExecutionProvenanceNode>,
  edges: Map<string, ExecutionProvenanceEdge>
): void {
  const goalNodeId = nodeId("goal", bundle.goal.id);
  putNode(
    nodes,
    buildNode({
      id: goalNodeId,
      type: "goal",
      ownerUserId: bundle.goal.userId,
      label: bundle.goal.title,
      summary: bundle.goal.explanation,
      createdAt: bundle.goal.createdAt,
      metadata: {
        status: bundle.goal.status,
        workspaceId: bundle.goal.workspaceId,
        confidence: bundle.goal.confidence
      }
    })
  );

  for (const task of bundle.tasks) {
    addTask(bundle.goal.userId, task, nodes, edges, goalNodeId);
  }

  for (const approval of bundle.approvals) {
    const approvalNodeId = nodeId("approval", approval.id);
    putNode(
      nodes,
      buildNode({
        id: approvalNodeId,
        type: "approval",
        ownerUserId: params.userId,
        label: approval.title,
        summary: approval.rationale,
        sensitivity: approval.riskClass,
        createdAt: approval.createdAt,
        metadata: {
          decision: approval.decision,
          riskClass: approval.riskClass,
          taskId: approval.taskId
        }
      })
    );
    putEdge(
      edges,
      buildEdge({
        type: approval.decision === "approved" ? "approved" : "created",
        from: goalNodeId,
        to: approvalNodeId,
        label: "Goal requires approval decision",
        createdAt: approval.createdAt
      })
    );

    putEdge(
      edges,
      buildEdge({
        type: "created",
        from: nodeId("task", approval.taskId),
        to: approvalNodeId,
        label: "Task created approval request",
        createdAt: approval.createdAt,
        metadata: {
          riskClass: approval.riskClass
        }
      })
    );
  }

  for (const action of bundle.actionLogs) {
    addActionLog(bundle.goal.userId, action, nodes, edges, goalNodeId);
  }

  for (const artifact of bundle.artifacts) {
    addArtifact(bundle.goal.userId, artifact, nodes, edges, goalNodeId);
  }
}

function addTask(
  userId: string,
  task: Task,
  nodes: Map<string, ExecutionProvenanceNode>,
  edges: Map<string, ExecutionProvenanceEdge>,
  goalNodeId: string
): void {
  const taskNodeId = nodeId("task", task.id);
  putNode(
    nodes,
    buildNode({
      id: taskNodeId,
      type: "task",
      ownerUserId: userId,
      label: task.title,
      summary: task.summary,
      sensitivity: task.riskClass,
      createdAt: task.createdAt,
      metadata: {
        goalId: task.goalId,
        workflowId: task.workflowId,
        assignedAgent: task.assignedAgent,
        state: task.state,
        riskClass: task.riskClass,
        requiresApproval: task.requiresApproval,
        dependsOn: task.dependsOn,
        artifactIds: task.artifactIds
      }
    })
  );
  putEdge(
    edges,
    buildEdge({
      type: "created",
      from: goalNodeId,
      to: taskNodeId,
      label: "Goal created workflow task",
      createdAt: task.createdAt
    })
  );

  for (const dependencyId of task.dependsOn) {
    putEdge(
      edges,
      buildEdge({
        type: "created",
        from: nodeId("task", dependencyId),
        to: taskNodeId,
        label: "Task depends on prior task",
        createdAt: task.createdAt
      })
    );
  }
}

function addActionLog(
  userId: string,
  action: ActionLog,
  nodes: Map<string, ExecutionProvenanceNode>,
  edges: Map<string, ExecutionProvenanceEdge>,
  goalNodeId: string
): void {
  const actionNodeId = nodeId("action", action.id);
  putNode(
    nodes,
    buildNode({
      id: actionNodeId,
      type: "action",
      ownerUserId: userId,
      label: action.kind,
      summary: action.message,
      createdAt: action.createdAt,
      metadata: {
        actor: action.actor,
        taskId: action.taskId,
        workflowId: action.workflowId
      }
    })
  );
  putEdge(
    edges,
    buildEdge({
      type: "executed",
      from: goalNodeId,
      to: actionNodeId,
      label: "Goal execution action",
      createdAt: action.createdAt
    })
  );

  if (action.taskId) {
    putEdge(
      edges,
      buildEdge({
        type: "executed",
        from: nodeId("task", action.taskId),
        to: actionNodeId,
        label: "Task emitted execution event",
        createdAt: action.createdAt
      })
    );
  }

  for (const memoryId of new Set(contextMemoryIdsFromAction(action))) {
    putEdge(
      edges,
      buildEdge({
        type: "uses_context",
        from: actionNodeId,
        to: nodeId("context_packet", `ctx_${memoryId}`),
        label: "Action used scoped memory context",
        createdAt: action.createdAt
      })
    );
  }
}

function addArtifact(
  userId: string,
  artifact: Artifact,
  nodes: Map<string, ExecutionProvenanceNode>,
  edges: Map<string, ExecutionProvenanceEdge>,
  goalNodeId: string
): void {
  const outputNodeId = nodeId("output", artifact.id);
  putNode(
    nodes,
    buildNode({
      id: outputNodeId,
      type: "output",
      ownerUserId: userId,
      label: artifact.title,
      summary: `${artifact.artifactType} output produced for goal ${artifact.goalId}.`,
      createdAt: artifact.createdAt,
      metadata: {
        artifactType: artifact.artifactType,
        taskId: artifact.taskId ?? null
      }
    })
  );
  putEdge(
    edges,
    buildEdge({
      type: "produced",
      from: goalNodeId,
      to: outputNodeId,
      label: "Goal produced output",
      createdAt: artifact.createdAt
    })
  );

  if (artifact.taskId) {
    putEdge(
      edges,
      buildEdge({
        type: "produced",
        from: nodeId("task", artifact.taskId),
        to: outputNodeId,
        label: "Task produced output",
        createdAt: artifact.createdAt
      })
    );
  }
}

function addEvidenceRecord(
  evidence: EvidenceRecord,
  nodes: Map<string, ExecutionProvenanceNode>,
  edges: Map<string, ExecutionProvenanceEdge>
): void {
  const decisionNodeId = nodeId("decision", evidence.id);
  const approvalNodeId = nodeId("approval", evidence.approvalId);
  putNode(
    nodes,
    buildNode({
      id: decisionNodeId,
      type: "decision",
      ownerUserId: evidence.userId,
      label: `${evidence.decision} approval`,
      summary: evidence.decisionRationale ?? evidence.sourceSummary,
      sensitivity: evidence.riskClass,
      createdAt: evidence.respondedAt,
      metadata: {
        decision: evidence.decision,
        decisionScope: evidence.decisionScope,
        taskId: evidence.taskId,
        approvalId: evidence.approvalId
      }
    })
  );

  putEdge(
    edges,
    buildEdge({
      type: "decided",
      from: approvalNodeId,
      to: decisionNodeId,
      label: "Approval decision recorded",
      createdAt: evidence.respondedAt
    })
  );

  putEdge(
    edges,
    buildEdge({
      type: "decided",
      from: nodeId("task", evidence.taskId),
      to: decisionNodeId,
      label: "Task state changed after approval decision",
      createdAt: evidence.respondedAt,
      metadata: {
        resultingTaskState: evidence.resultingTaskState,
        resultingGoalStatus: evidence.resultingGoalStatus
      }
    })
  );

  for (const memoryId of evidence.memoryIds) {
    putEdge(
      edges,
      buildEdge({
        type: "uses_context",
        from: decisionNodeId,
        to: nodeId("context_packet", `ctx_${memoryId}`),
        label: "Decision used linked memory evidence",
        createdAt: evidence.respondedAt
      })
    );
  }

  for (const artifactId of evidence.artifactIds) {
    putEdge(
      edges,
      buildEdge({
        type: "captured",
        from: decisionNodeId,
        to: nodeId("output", artifactId),
        label: "Decision captured output evidence",
        createdAt: evidence.respondedAt
      })
    );
  }
}

function addJob(
  job: JobRecord,
  nodes: Map<string, ExecutionProvenanceNode>,
  edges: Map<string, ExecutionProvenanceEdge>
): void {
  const jobNodeId = nodeId("job", job.id);
  putNode(
    nodes,
    buildNode({
      id: jobNodeId,
      type: "job",
      ownerUserId: job.userId,
      label: `${job.kind} ${job.status}`,
      summary: `Durable ${job.kind} job is ${job.status} after ${job.attemptCount}/${job.maxAttempts} attempts.`,
      createdAt: job.createdAt,
      metadata: {
        kind: job.kind,
        status: job.status,
        priority: job.priority,
        queue: job.queue,
        attemptCount: job.attemptCount,
        maxAttempts: job.maxAttempts,
        concurrencyKey: job.concurrencyKey
      }
    })
  );

  const payloadGoalId = goalIdFromPayload(job.payload);
  if (payloadGoalId) {
    putEdge(
      edges,
      buildEdge({
        type: "queued",
        from: nodeId("goal", payloadGoalId),
        to: jobNodeId,
        label: "Goal queued durable job",
        createdAt: job.createdAt
      })
    );
  }

  if (job.journal.replayedFromJobId) {
    putEdge(
      edges,
      buildEdge({
        type: "replayed_from",
        from: nodeId("job", job.journal.replayedFromJobId),
        to: jobNodeId,
        label: "Job replayed from prior attempt",
        createdAt: job.createdAt
      })
    );
  }

  if (job.status === "dead_letter") {
    const failureNodeId = nodeId("failure", job.id);
    putNode(
      nodes,
      buildNode({
        id: failureNodeId,
        type: "failure",
        ownerUserId: job.userId,
        label: `${job.kind} dead letter`,
        summary: job.lastError ? truncate(job.lastError) : "Durable job entered the dead-letter state.",
        createdAt: job.deadLetteredAt ?? job.updatedAt,
        metadata: {
          jobId: job.id,
          recoveryStrategy: job.journal.recovery?.strategy ?? null
        }
      })
    );
    putEdge(
      edges,
      buildEdge({
        type: "failed",
        from: jobNodeId,
        to: failureNodeId,
        label: "Job failure captured",
        createdAt: job.deadLetteredAt ?? job.updatedAt
      })
    );
  }
}

function addMemory(
  memory: MemoryRecord,
  nodes: Map<string, ExecutionProvenanceNode>,
  edges: Map<string, ExecutionProvenanceEdge>
): void {
  const memoryNodeId = nodeId("memory", memory.id);
  const packet = buildContextPacketFromMemory(memory);
  const packetNodeId = nodeId("context_packet", packet.id);
  putNode(
    nodes,
    buildNode({
      id: memoryNodeId,
      type: "memory",
      ownerUserId: memory.userId,
      label: memory.category,
      summary: `${memory.memoryType} memory captured from ${memory.source}.`,
      sensitivity: memory.sensitivity,
      createdAt: memory.createdAt,
      metadata: {
        memoryType: memory.memoryType,
        permissions: memory.permissions,
        advisoryOnly: memory.memoryType === "inferred"
      }
    })
  );
  putNode(
    nodes,
    buildNode({
      id: packetNodeId,
      type: "context_packet",
      ownerUserId: memory.userId,
      label: packet.category,
      summary: packet.contentSummary,
      sensitivity: packet.sensitivity,
      createdAt: packet.createdAt,
      metadata: {
        freshness: packet.freshness.status,
        sourceMemoryIds: packet.lineage.sourceMemoryIds,
        memoryType: packet.memoryType,
        advisoryOnly: packet.memoryType === "inferred"
      }
    })
  );
  putEdge(
    edges,
    buildEdge({
      type: "derived_from",
      from: memoryNodeId,
      to: packetNodeId,
      label: "Context packet derived from memory",
      createdAt: packet.updatedAt
    })
  );
}

function applyTraversal(params: {
  nodes: ExecutionProvenanceNode[];
  edges: ExecutionProvenanceEdge[];
  rootId: string | null;
  depth: number;
  limit: number;
}): { nodes: ExecutionProvenanceNode[]; edges: ExecutionProvenanceEdge[] } {
  if (!params.rootId) {
    const nodes = params.nodes.slice(0, params.limit);
    const nodeIds = new Set(nodes.map((node) => node.id));
    return {
      nodes,
      edges: params.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
    };
  }

  const nodesById = new Map(params.nodes.map((node) => [node.id, node]));
  const visited = new Set<string>([params.rootId]);
  const queue: Array<{ id: string; depth: number }> = [{ id: params.rootId, depth: 0 }];

  while (queue.length > 0 && visited.size < params.limit) {
    const current = queue.shift()!;
    if (current.depth >= params.depth) {
      continue;
    }

    for (const edge of params.edges) {
      if (edge.from !== current.id && edge.to !== current.id) {
        continue;
      }

      const nextId = edge.from === current.id ? edge.to : edge.from;
      if (visited.has(nextId) || !nodesById.has(nextId)) {
        continue;
      }

      visited.add(nextId);
      queue.push({ id: nextId, depth: current.depth + 1 });
      if (visited.size >= params.limit) {
        break;
      }
    }
  }

  const nodes = [...visited]
    .map((id) => nodesById.get(id))
    .filter((node): node is ExecutionProvenanceNode => Boolean(node));
  return {
    nodes,
    edges: params.edges.filter((edge) => visited.has(edge.from) && visited.has(edge.to))
  };
}

export function buildExecutionProvenanceGraph(params: BuildExecutionProvenanceGraphParams): ExecutionProvenanceGraph {
  const nodes = new Map<string, ExecutionProvenanceNode>();
  const edges = new Map<string, ExecutionProvenanceEdge>();
  const depth = Math.max(0, Math.min(Math.trunc(params.depth ?? 2), 4));
  const limit = Math.max(1, Math.min(Math.trunc(params.limit ?? 250), 500));

  for (const bundle of params.goals) {
    addGoalBundle(params, bundle, nodes, edges);
  }

  for (const evidence of params.evidenceRecords ?? []) {
    addEvidenceRecord(evidence, nodes, edges);
  }

  for (const job of params.jobs) {
    addJob(job, nodes, edges);
  }

  for (const memory of params.memories) {
    addMemory(memory, nodes, edges);
  }

  const sortedNodes = [...nodes.values()].sort((left, right) => {
    const createdOrder = (right.createdAt ?? "").localeCompare(left.createdAt ?? "");
    return createdOrder !== 0 ? createdOrder : left.id.localeCompare(right.id);
  });
  const sortedEdges = [...edges.values()].sort((left, right) => left.id.localeCompare(right.id));
  const selected = applyTraversal({
    nodes: sortedNodes,
    edges: sortedEdges,
    rootId: params.rootId ?? null,
    depth,
    limit
  });
  const selectedNodeIds = new Set(selected.nodes.map((node) => node.id));
  const timeline = selected.nodes
    .filter((node) => node.createdAt)
    .sort((left, right) => left.createdAt!.localeCompare(right.createdAt!))
    .slice(0, limit)
    .map((node) => ({
      id: `timeline:${node.id}`,
      nodeId: node.id,
      at: node.createdAt!,
      type: node.type,
      label: node.label,
      summary: node.summary
    }));

  return ExecutionProvenanceGraphSchema.parse({
    nodes: selected.nodes,
    edges: selected.edges.filter((edge) => selectedNodeIds.has(edge.from) && selectedNodeIds.has(edge.to)),
    timeline,
    query: {
      rootId: params.rootId ?? null,
      depth,
      limit
    }
  });
}

# Production Wedges And Completion Contracts

This runbook records the two explicitly selected Phase 3 production wedges and the completion contracts that now ship in the runtime `Goal` contract.

The selected wedges no longer report as scaffold-only execution. They now run through the shared `governed_specialist` execution mode, which means the repo treats them as production specialist paths while still keeping any side effect behind approval, policy, and authz boundaries.

## Selected Production Wedges

### 1. Communications execution

- Intent: `communications-triage`
- Runtime wedge key: `communications_execution`
- Why it is selected:
  - it represents the highest-signal inbox triage and follow-up flow already backed by typed action intents, approval gating, and replayable recovery paths

Completion contract:
- urgent and high-signal inbound threads are reviewed and ranked
- actionable reply drafts or escalation notes are prepared
- follow-up commitments are captured before any external send is executed
- external sends remain behind the approval boundary until a human decision exists

### 2. Scheduling execution

- Intent: `weekly-planning`
- Runtime wedge key: `scheduling_execution`
- Why it is selected:
  - it is the most mature calendar-centric workflow in the current repo and already maps onto the typed scheduling and approval surfaces

Completion contract:
- current commitments and deadlines are consolidated into one planning view
- a weekly operating plan is drafted with focus blocks, tradeoffs, and risks
- calendar write-side changes remain reviewable instead of silently auto-committing

## Supporting Wedges

The runtime also tags supporting workflows so older or non-selected flows still have an explicit contract:

- `travel_readiness` for `travel-readiness`
- `briefing` for `briefing:*`
- `general_coordination` as the fallback profile

These are intentionally marked as supporting rather than selected production wedges.

## Runtime Source Of Truth

The canonical source is [packages/contracts/src/index.ts](/Users/leonardwongly/.codex/worktrees/24f9/Agentic/packages/contracts/src/index.ts), via:

- `GoalWedgeSchema`
- `GoalCompletionContractSchema`
- `deriveGoalContract(intent)`

Goals created after this change persist the chosen wedge and completion contract in the `goals.goal_contract` JSONB column. Legacy rows derive the same profile from `goal.intent` during parsing, so the contract stays backwards-compatible.

# Role-scoped workflow permissions

This runbook defines which shared-workspace roles can inspect workflow state versus mutate or recover it. The intent is to keep execution recovery available to trusted collaborators without widening governance or approval authority.

## Permission matrix

| Surface | Owner | Editor | Viewer |
| --- | --- | --- | --- |
| Inspect shared goals, approvals, watchers, autopilot events, and runtime jobs | Yes | Yes | Yes |
| Refine shared goals | Yes | Yes | No |
| Create, pause, or resume shared watchers | Yes | Yes | No |
| Trigger shared watcher autopilot events | Yes | Yes | No |
| Replay shared dead-letter jobs | Yes | Yes | No |
| Respond to approvals | Yes | No | No |
| Manage goal shares | Yes | Yes | No |
| Change workspace governance, membership, privacy, and autopilot posture | Yes | No | No |

## Boundary rules

- Visibility is repository-scoped as well as route-scoped. Shared members can load the same goal and job records the UI surfaces, while unrelated personal-workspace records stay hidden.
- Mutation checks run at the API boundary. A viewer should be able to inspect state but receive a `403` before queueing a refine, watcher mutation, autopilot trigger, or replay.
- UI controls should mirror the API decision. Buttons stay visible so operators understand the available recovery path, but disabled controls must explain why the action is blocked.

## Break-glass semantics

- Owners hold governance authority. They approve risky work, manage workspace policy, rotate membership, and own privacy or sharing lifecycle decisions.
- Editors hold execution-recovery authority. They can refine shared goals, manage watchers, trigger shared watcher runs, and replay dead-letter jobs, but they cannot widen governance or answer approvals on behalf of the owner.
- Viewers hold inspection authority. They can audit the workflow, see failures, and escalate, but they cannot change shared execution state.

## Audit evidence

- Goal refinements record the acting session or system actor in the queued job and resulting action log.
- Watcher mutations and watcher-triggered autopilot events preserve actor and responsibility context so recovery actions are attributable.
- Dead-letter replays pass through the governed mutation boundary, validate optional idempotency keys, apply replay-specific abuse limits, and preserve `replayedFromJobId` metadata plus queue journal recovery entries.
- Approval responses remain owner-attributed even when other shared members can inspect the surrounding workflow state.

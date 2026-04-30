# Agent runner contracts

Agent runners are the boundary between planner-selected tasks and executable
agent behavior. A runner must declare and validate:

- agent names it can serve
- contract version
- typed input and output shape
- allowed output execution modes
- timeout budget
- telemetry events
- failure taxonomy
- capability and risk permissions

The shared schemas live in `@agentic/contracts`:

- `AgentRunnerContractSchema`
- `AgentRunnerInputSchema`
- `AgentRunnerOutputSchema`
- `AgentRunnerPermissionsSchema`
- `AgentRunnerFailureCodeSchema`

The runtime adapter interface lives in `@agentic/agents` as `AgentRunner`.
Registration must go through `validateAgentRunnerRegistration(...)`, which
rejects unsupported capability claims before a runner can execute. Runtime
invocation uses `runAgent(...)`, which builds a typed runner input, checks task
capabilities against the runner permissions, and returns a schema-validated
`AgentResult`.

Current reference adapters:

- `agentic.built-in.deterministic-runner` serves built-in deterministic and
  governed-specialist outputs.
- `agentic.custom-prompt.scaffold-runner` serves custom agent definitions as
  scaffolded artifacts until a model-backed runner is introduced.

Failure codes are intentionally explicit:

- `validation_failure`
- `permission_denied`
- `dependency_failure`
- `timeout`
- `unsafe_output`
- `unsupported_agent`

Security rules:

- Client-provided capability or ownership claims are not trusted.
- Task capabilities must fit the built-in agent allowlist.
- Custom agents cannot execute task capabilities they did not declare.
- Blocked capabilities win over allowed capabilities.
- Tasks above an agent runner's maximum risk class fail closed.
- Side-effect capabilities must be explicitly declared.

Rollout is backward-compatible because existing `runAgent(...)` callers keep the
same public function shape. Rollback is to restore the previous direct helper
implementation and remove the contract schemas only if no downstream code has
started importing them.

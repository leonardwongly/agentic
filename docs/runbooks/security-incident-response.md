# Security Incident Response Runbook

## Purpose

This runbook defines how Agentic responds to production security incidents. It complements the deployment runbook by focusing on containment, evidence preservation, communication, and recovery for security-specific events.

Severity targets are defined in [`config/security/incident-severity.json`](../../config/security/incident-severity.json).

## Incident triggers

Use this runbook when any of the following occur:

- confirmed or suspected credential compromise
- confirmed or suspected authorization bypass
- evidence of data exfiltration, tampering, or destructive activity
- repeated exploit attempts that breach expected controls
- vulnerability disclosure that materially affects the current production release
- rollout-gate or telemetry signals suggesting an active abuse or compromise pattern

## Roles

- Incident commander: owns decisions, sequencing, and timeline
- Communications lead: owns stakeholder and customer communications
- Operations lead: owns deploy, rollback, credential rotation, and access controls
- Investigator: owns evidence collection, scope determination, and retrospective inputs

One person may cover multiple roles early in an incident, but the responsibilities must remain explicit.

## Immediate response

1. Classify severity using `config/security/incident-severity.json`.
2. Open a dedicated incident record using the retrospective template in [`docs/runbooks/templates/security-incident-retrospective.md`](templates/security-incident-retrospective.md).
3. Record the detection time, suspected blast radius, affected systems, and current hypotheses.
4. Preserve volatile evidence before changing the system when feasible.

Evidence to preserve:

- CI artifacts from the current deployed build
- rollout-gate outputs and retained telemetry
- provider deploy logs
- relevant API, worker, and audit export traces
- any vulnerability reports or reproduction steps

## Containment checklist

1. Stop the active exploit path.
2. Revoke or rotate compromised credentials.
3. Disable unsafe traffic paths or affected features behind existing gates if that reduces exposure.
4. Roll back to the previous known-good release when the current release is implicated.
5. Increase logging or evidence capture only if the added logging does not leak new sensitive data.

Containment actions should prefer:

- least additional blast radius
- reversibility
- preservation of forensics evidence

## Investigation checklist

1. Confirm entry point and trust boundary crossed.
2. Determine whether the issue is active exploitation or latent exposure.
3. Identify affected users, workspaces, secrets, or deploy artifacts.
4. Confirm whether any evidence indicates persistence or lateral movement.
5. Map the incident back to the relevant controls in `config/compliance/controls.json`.

## Recovery

Recovery is complete only when:

- the vulnerable path is patched or disabled
- replacement credentials are deployed where needed
- readiness and smoke checks pass
- monitoring confirms the exploit pattern is no longer active
- customer or stakeholder communication obligations are satisfied

Use the standard deploy process after the fix:

```bash
npm run build
npm test
npm run test:security:regression
npm run test:smoke:deployment
npm run test:smoke:deployment-async
npm run telemetry:rollout-gate -- --dir "${AGENTIC_TELEMETRY_RETENTION_DIR:-.agentic/telemetry}"
```

## Communication expectations

- Sev1 and Sev2 require named incident ownership and executive visibility.
- External disclosure must coordinate with the disclosure runbook in [`security-disclosure.md`](security-disclosure.md).
- Never publish unverified blast-radius claims.
- Never include secrets or customer-specific sensitive payloads in broad incident channels.

## Exit criteria

Close the incident only after:

- timeline and root cause are documented
- corrective actions are filed and linked
- customer impact is known or explicitly bounded
- a retrospective is scheduled or complete within the severity SLA

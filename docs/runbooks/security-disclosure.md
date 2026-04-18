# Security Disclosure Runbook

## Purpose

This runbook defines how Agentic handles incoming vulnerability disclosures and any required outbound disclosure.

## Intake

For incoming reports:

1. Acknowledge receipt quickly according to the severity targets in [`config/security/incident-severity.json`](../../config/security/incident-severity.json).
2. Record the reporter, submission time, affected area, and reproduction details.
3. Avoid promising timelines before triage is complete.

## Evaluation

1. Confirm whether the report is new, duplicate, or already mitigated.
2. Determine affected versions and whether exploitation appears active.
3. Decide whether this is:
   - coordinated disclosure
   - immediate public advisory requirement
   - internal-only remediation

## Outbound disclosure rules

- Do not publish before mitigation guidance exists unless a regulator, customer contract, or active exploitation risk requires it.
- Keep technical details accurate and scoped.
- Include version boundaries, mitigations, and upgrade instructions.
- Do not expose secret values, customer identifiers, or unnecessary internal implementation details.

## Minimum disclosure record

- summary of the issue
- affected components or versions
- severity and impact statement
- mitigation or patch guidance
- detection and disclosure dates
- owner for follow-up questions

## Coordination

- Sev1 and Sev2 issues require coordination with the incident response runbook.
- If the disclosure resulted from a CI or internal finding, link the relevant evidence bundle and tests.
- If the report is invalid, document why and preserve the evaluation notes for future triage.

# Compliance Controls and Evidence

## Purpose

Agentic now treats compliance evidence as a generated build artifact, not a manual spreadsheet exercise. The source of truth for the control program lives in [`config/compliance/controls.json`](../../config/compliance/controls.json).

Each control maps:

- trust boundaries
- product surfaces
- enforcing code paths
- operator runbooks
- automated checks
- expected evidence artifacts

The collector script verifies that all referenced files exist, hashes generated artifacts, and emits a machine-readable and human-readable evidence bundle into `artifacts/compliance`.

## Local usage

Generate a local control matrix without requiring already-built artifacts:

```bash
npm run security:collect-evidence
```

Generate the full CI-grade evidence bundle and fail if required artifacts are missing:

```bash
mkdir -p artifacts/security artifacts/build artifacts/compliance
npm run security:audit-runtime -- --report artifacts/security/runtime-audit-report.json
npm run security:sbom -- --output artifacts/security/agentic-sbom.spdx.json
docker build -t agentic-local:test .
tar -czf artifacts/build/agentic-runtime-bundle.tgz apps/web/.next apps/web/package.json apps/worker/package.json package.json package-lock.json packages scripts
docker save agentic-local:test -o artifacts/build/agentic-image.tar
npm run security:collect-evidence -- --require-artifacts
```

## Generated outputs

The collector writes:

- `artifacts/compliance/control-matrix.json`
- `artifacts/compliance/control-matrix.md`
- `artifacts/compliance/evidence-manifest.json`

These outputs are intended to answer three questions quickly:

1. Which product controls are supposed to exist?
2. Which code, tests, and runbooks implement them?
3. Which evidence artifacts prove those controls operated in this build?

## Review cadence

- Update the control registry whenever a new trust boundary or release gate is introduced.
- Review `config/compliance/controls.json` and `config/security/incident-severity.json` during any significant architecture or governance change.
- Treat missing evidence as a release blocker in CI.
- Keep uploaded GitHub Actions evidence artifacts to 7 days unless an investigation requires manual preservation. The scheduled `Artifact Cleanup` workflow deletes older artifacts daily, and manual runs can use `dry-run` to preview deletions before changing repository state. Pull request validation still builds and validates the evidence bundle, but never uploads it. Non-PR CI runs also require the repository variable `ENABLE_SUPPLY_CHAIN_ARTIFACT_UPLOAD=true` before uploading evidence, so storage quota pressure cannot turn otherwise valid builds red.

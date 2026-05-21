# Supply-Chain Security Controls

## Runtime vulnerability gate

CI and staging deploy use `npm run security:audit-runtime` instead of a raw `npm audit` call. The gate evaluates production dependency findings at `moderate` severity or above and only allows exceptions that are explicitly recorded in [`runtime-vulnerability-exceptions.json`](../../.github/security/runtime-vulnerability-exceptions.json).

### Exception process

1. Confirm the finding is real and not already fixed in the lockfile.
2. Create a temporary exception entry with:
   - `package`
   - `advisoryId` when the audit report provides one
   - `severity` when the advisory ID is not stable
   - `owner`
   - `reason`
   - `expiresAt`
3. Add the exception in the same change that documents mitigation or rollback steps.
4. Keep expiry short. The default expectation is days, not quarters.
5. Remove the exception as part of the patch release.

Expired exceptions are treated as blocking failures by CI.
The exception file is schema checked: unknown fields, invalid severities, and malformed expiry timestamps fail the gate instead of being ignored.

## Dependency ownership

The current runtime audit surface is owned as follows:

- `next`: direct production dependency owned by the web runtime track.
- `postcss`: transitive runtime dependency pulled by `next`; patched through an npm `overrides` entry until `next` publishes a version with a non-vulnerable PostCSS dependency.
- `vite`: transitive development/test dependency pulled by Vitest and Vite React tooling; patched through the lockfile refresh path.

When npm reports a finding through a parent package, update the direct parent when available. Use `overrides` only for a narrowly scoped transitive patch, and remove the override when the parent package carries the fixed dependency itself.

## Evidence artifacts

CI and staging deploy both emit:

- runtime vulnerability gate evaluation JSON
- SPDX SBOM JSON for the deployable runtime dependency set
- deployable bundle tarball
- container image tarball

These artifacts are uploaded into workflow storage for audit and incident-response use.
Pull request builds still generate and validate the same evidence bundle, but skip upload to avoid artifact-quota failures before merge. Push-based builds keep uploading the evidence bundle.

## Third-party scanner quota statuses

External scanner quota or account-status failures, such as Snyk reporting `Code test limit reached`, are waiver-eligible only as scanner availability failures. Treat them as unresolved third-party status, not as a clean security scan.

A waiver must record the exact failing context and message, and it must be paired with current evidence that the repo-owned gates passed: runtime vulnerability gate, dependency review where applicable, provenance validation, test/build validation, and at least one independent dependency or supply-chain scanner such as Socket or the generated SBOM workflow evidence. Do not waive a scanner quota failure when the failure includes a concrete vulnerability finding, a reachable exploit report, a policy violation, or a target URL with actionable scan details.

When a quota/status waiver is used, keep the failed external status visible in the handoff and rerun or re-enable the scanner once quota is restored. Do not create a runtime vulnerability exception for quota exhaustion; exceptions are only for known advisories with documented mitigation and expiry.

## Provenance

Push-based builds attest the generated security evidence and deployable build artifacts with GitHub build provenance so the team can trace which workflow and commit produced them.
External GitHub Actions in CI and staging workflows are pinned to immutable commit SHAs and checked by `npm run ci:validate-provenance`. Keep the trailing version comments when refreshing pins so reviewers can see which upstream release tag the SHA came from.

## Rollback

If the PostCSS override causes a framework regression, revert the override and the lockfile refresh together, add a short-lived exception for the specific advisory, and keep `npm run security:audit-runtime -- --minimum-severity moderate` red until the exception is reviewed and time-bound.

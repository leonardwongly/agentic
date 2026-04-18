# Supply-Chain Security Controls

## Runtime vulnerability gate

CI and staging deploy use `npm run security:audit-runtime` instead of a raw `npm audit` call. The gate evaluates production dependency findings at `high` severity or above and only allows exceptions that are explicitly recorded in [`runtime-vulnerability-exceptions.json`](../../.github/security/runtime-vulnerability-exceptions.json).

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

## Evidence artifacts

CI and staging deploy both emit:

- runtime vulnerability gate evaluation JSON
- SPDX SBOM JSON for the deployable runtime dependency set
- deployable bundle tarball
- container image tarball

These artifacts are uploaded into workflow storage for audit and incident-response use.

## Provenance

Push-based builds attest the generated security evidence and deployable build artifacts with GitHub build provenance so the team can trace which workflow and commit produced them.

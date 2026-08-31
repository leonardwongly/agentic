import type {
  GoalShareRecord,
  IntegrationAccount,
  MemoryRecord,
  ProviderCredential,
  ProviderCredentialSecretRecord,
  WorkspaceMember
} from "@agentic/contracts";

export function integrationStoreKey(account: Pick<IntegrationAccount, "id" | "userId">): string {
  return `${account.userId}:${account.id}`;
}

export function workspaceMemberStoreKey(member: Pick<WorkspaceMember, "workspaceId" | "userId">): string {
  return `${member.workspaceId}:${member.userId}`;
}

export function providerCredentialStoreKey(credential: Pick<ProviderCredential, "id" | "userId">): string {
  return `${credential.userId}:${credential.id}`;
}

export function memoryStoreKey(memory: Pick<MemoryRecord, "id" | "userId">): string {
  return `${memory.userId}:${memory.id}`;
}

export function providerCredentialSecretStoreKey(
  record: Pick<ProviderCredentialSecretRecord, "credentialId" | "kind" | "userId">
): string {
  return `${record.userId}:${record.credentialId}:${record.kind}`;
}

export function goalShareFingerprintStoreKey(share: Pick<GoalShareRecord, "tokenFingerprint">): string {
  return share.tokenFingerprint.toLowerCase();
}

import {
  createProviderCredentialSecretStore,
  decryptProviderCredentialSecret,
  ProviderCredentialSecretError
} from "@agentic/integrations";

describe("provider credential secrets", () => {
  it("round-trips encrypted provider secrets", () => {
    const store = createProviderCredentialSecretStore({
      masterKey: "test-provider-master-key",
      keyVersion: "test-v1"
    });
    const envelope = store.encrypt("refresh-token-123");

    expect(envelope.keyVersion).toBe("test-v1");
    expect(store.decrypt(envelope)).toBe("refresh-token-123");
  });

  it("rejects empty provider secrets", () => {
    const store = createProviderCredentialSecretStore({
      masterKey: "test-provider-master-key"
    });

    expect(() => store.encrypt("")).toThrow(ProviderCredentialSecretError);
    expect(() => store.encrypt("")).toThrow("Provider secret cannot be empty.");
  });

  it("rejects oversized provider secrets", () => {
    const store = createProviderCredentialSecretStore({
      masterKey: "test-provider-master-key"
    });

    expect(() => store.encrypt("x".repeat(8_193))).toThrow(ProviderCredentialSecretError);
    expect(() => store.encrypt("x".repeat(8_193))).toThrow("Provider secret exceeds the supported size limit.");
  });

  it("fails closed when the master key is missing", () => {
    expect(() => createProviderCredentialSecretStore({ masterKey: "" })).toThrow(ProviderCredentialSecretError);
    expect(() => createProviderCredentialSecretStore({ masterKey: "" })).toThrow(
      "Provider credential encryption key is not configured."
    );
  });

  it("rejects tampered encrypted envelopes", () => {
    const store = createProviderCredentialSecretStore({
      masterKey: "test-provider-master-key"
    });
    const envelope = store.encrypt("refresh-token-123");
    const tamperedAuthTag = Buffer.from(envelope.authTag, "base64");

    tamperedAuthTag[0] = tamperedAuthTag[0]! ^ 0xff;

    const tamperedEnvelope = {
      ...envelope,
      authTag: tamperedAuthTag.toString("base64")
    };

    expect(() => store.decrypt(tamperedEnvelope)).toThrow(ProviderCredentialSecretError);
    expect(() => store.decrypt(tamperedEnvelope)).toThrow("Provider secret decryption failed.");
  });

  it("binds encrypted provider secrets to credential tenant context", () => {
    const store = createProviderCredentialSecretStore({
      masterKey: "test-provider-master-key"
    });
    const envelope = store.encrypt("refresh-token-123", {
      credentialId: "google:workspace-1:acct-1",
      userId: "user-1",
      kind: "oauth_refresh_token"
    });

    expect(
      store.decrypt(envelope, {
        credentialId: "google:workspace-1:acct-1",
        userId: "user-1",
        kind: "oauth_refresh_token"
      })
    ).toBe("refresh-token-123");
    expect(() =>
      store.decrypt(envelope, {
        credentialId: "google:workspace-1:acct-1",
        userId: "user-2",
        kind: "oauth_refresh_token"
      })
    ).toThrow("Provider secret decryption failed.");
  });

  it("keeps legacy unbound provider secrets readable during rollout", () => {
    const store = createProviderCredentialSecretStore({
      masterKey: "test-provider-master-key"
    });
    const envelope = store.encrypt("legacy-refresh-token");

    expect(
      decryptProviderCredentialSecret({
        store,
        envelope,
        context: {
          credentialId: "google:workspace-1:acct-1",
          userId: "user-1",
          kind: "oauth_refresh_token"
        }
      })
    ).toBe("legacy-refresh-token");
  });
});

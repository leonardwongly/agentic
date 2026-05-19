import {
  createProviderCredentialSecretStore,
  decryptProviderCredentialSecret,
  ProviderCredentialSecretError,
  rotateProviderCredentialSecretRecord
} from "@agentic/integrations";

describe("provider credential secrets", () => {
  const originalProviderKeyring = process.env.AGENTIC_PROVIDER_SECRET_KEYRING;
  const context = {
    credentialId: "google:workspace-1:acct-1",
    userId: "user-1",
    kind: "oauth_refresh_token"
  };

  afterEach(() => {
    if (originalProviderKeyring === undefined) {
      delete process.env.AGENTIC_PROVIDER_SECRET_KEYRING;
    } else {
      process.env.AGENTIC_PROVIDER_SECRET_KEYRING = originalProviderKeyring;
    }
  });

  it("round-trips encrypted provider secrets", () => {
    const store = createProviderCredentialSecretStore({
      masterKey: "test-provider-master-key",
      keyVersion: "test-v1"
    });
    const envelope = store.encrypt("refresh-token-123", context);

    expect(envelope.keyVersion).toBe("test-v1");
    expect(envelope.contextBinding).toEqual({
      version: "provider-credential-v1",
      digest: expect.any(String)
    });
    expect(store.decrypt(envelope, context)).toBe("refresh-token-123");
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
    const envelope = store.encrypt("refresh-token-123", context);

    expect(store.decrypt(envelope, context)).toBe("refresh-token-123");
    expect(() =>
      store.decrypt(envelope, {
        credentialId: "google:workspace-1:acct-1",
        userId: "user-2",
        kind: "oauth_refresh_token"
      })
    ).toThrow("Provider secret decryption failed.");
  });

  it("fails closed when credential id or secret kind context does not match", () => {
    const store = createProviderCredentialSecretStore({
      masterKey: "test-provider-master-key"
    });
    const envelope = store.encrypt("refresh-token-123", context);

    expect(() =>
      store.decrypt(envelope, {
        ...context,
        credentialId: "google:workspace-1:acct-2"
      })
    ).toThrow("Provider secret decryption failed.");
    expect(() =>
      store.decrypt(envelope, {
        ...context,
        kind: "oauth_access_token"
      })
    ).toThrow("Provider secret decryption failed.");
  });

  it("rejects malformed provider secret keyring configuration", () => {
    process.env.AGENTIC_PROVIDER_SECRET_KEYRING = "[]";

    expect(() =>
      createProviderCredentialSecretStore({
        masterKey: "test-provider-master-key"
      })
    ).toThrow("AGENTIC_PROVIDER_SECRET_KEYRING must be a JSON object of key versions to secrets.");

    process.env.AGENTIC_PROVIDER_SECRET_KEYRING = JSON.stringify({
      "": "old-provider-master-key"
    });

    expect(() =>
      createProviderCredentialSecretStore({
        masterKey: "test-provider-master-key"
      })
    ).toThrow("AGENTIC_PROVIDER_SECRET_KEYRING contains an invalid key version or secret.");
  });

  it("does not silently fall back to legacy unbound provider secrets", () => {
    const store = createProviderCredentialSecretStore({
      masterKey: "test-provider-master-key"
    });
    const envelope = store.encrypt("legacy-refresh-token");

    expect(() =>
      decryptProviderCredentialSecret({
        store,
        envelope,
        context
      })
    ).toThrow("Provider secret decryption failed.");
  });

  it("keeps legacy unbound provider secrets readable only when migration explicitly opts in", () => {
    const store = createProviderCredentialSecretStore({
      masterKey: "test-provider-master-key"
    });
    const envelope = store.encrypt("legacy-refresh-token");

    expect(
      decryptProviderCredentialSecret({
        store,
        envelope,
        context,
        allowLegacyContextFallback: true
      })
    ).toBe("legacy-refresh-token");
  });

  it("decrypts older key versions from an explicit keyring", () => {
    const oldStore = createProviderCredentialSecretStore({
      masterKey: "old-provider-master-key",
      keyVersion: "2026-01"
    });
    const envelope = oldStore.encrypt("refresh-token-123", context);
    const rotatedStore = createProviderCredentialSecretStore({
      masterKey: "new-provider-master-key",
      keyVersion: "2026-02",
      keyring: {
        "2026-01": "old-provider-master-key"
      }
    });

    expect(rotatedStore.currentKeyVersion).toBe("2026-02");
    expect(rotatedStore.decrypt(envelope, context)).toBe("refresh-token-123");
  });

  it("fails closed when an encrypted envelope key version is unavailable", () => {
    const oldStore = createProviderCredentialSecretStore({
      masterKey: "old-provider-master-key",
      keyVersion: "2026-01"
    });
    const envelope = oldStore.encrypt("refresh-token-123", context);
    const newOnlyStore = createProviderCredentialSecretStore({
      masterKey: "new-provider-master-key",
      keyVersion: "2026-02"
    });

    expect(() => newOnlyStore.decrypt(envelope, context)).toThrow(ProviderCredentialSecretError);
    expect(() => newOnlyStore.decrypt(envelope, context)).toThrow(
      "Provider credential encryption key version 2026-01 is not configured."
    );
  });

  it("plans credential secret rotation without mutating the stored record", () => {
    const oldStore = createProviderCredentialSecretStore({
      masterKey: "old-provider-master-key",
      keyVersion: "2026-01"
    });
    const record = {
      credentialId: context.credentialId,
      userId: context.userId,
      kind: "oauth_refresh_token" as const,
      secret: oldStore.encrypt("refresh-token-123", context),
      createdAt: "2026-05-18T00:00:00.000Z",
      updatedAt: "2026-05-18T00:00:00.000Z"
    };
    const rotatedStore = createProviderCredentialSecretStore({
      masterKey: "new-provider-master-key",
      keyVersion: "2026-02",
      keyring: {
        "2026-01": "old-provider-master-key"
      }
    });
    const result = rotateProviderCredentialSecretRecord({
      store: rotatedStore,
      record,
      context,
      mode: "dry-run",
      rotatedAt: "2026-05-18T01:00:00.000Z"
    });

    expect(result).toMatchObject({
      mode: "dry-run",
      action: "rotate",
      reason: "key-version",
      previousKeyVersion: "2026-01",
      nextKeyVersion: "2026-02",
      legacyContextFallbackUsed: false,
      record
    });
    expect(result.rotatedRecord?.secret.keyVersion).toBe("2026-02");
    expect(result.record.secret.keyVersion).toBe("2026-01");
  });

  it("plans rotation for pre-binding context-authenticated envelopes", () => {
    const store = createProviderCredentialSecretStore({
      masterKey: "test-provider-master-key",
      keyVersion: "2026-02"
    });
    const { contextBinding: _contextBinding, ...legacyEnvelope } = store.encrypt("refresh-token-123", context);
    const record = {
      credentialId: context.credentialId,
      userId: context.userId,
      kind: "oauth_refresh_token" as const,
      secret: legacyEnvelope,
      createdAt: "2026-05-18T00:00:00.000Z",
      updatedAt: "2026-05-18T00:00:00.000Z"
    };

    const result = rotateProviderCredentialSecretRecord({
      store,
      record,
      context,
      mode: "dry-run",
      rotatedAt: "2026-05-18T01:00:00.000Z"
    });

    expect(result).toMatchObject({
      action: "rotate",
      reason: "context-binding",
      previousKeyVersion: "2026-02",
      nextKeyVersion: "2026-02"
    });
    expect(result.rotatedRecord?.secret.contextBinding).toEqual({
      version: "provider-credential-v1",
      digest: expect.any(String)
    });
  });

  it("commits credential secret rotation and binds legacy envelopes to context", () => {
    const legacyStore = createProviderCredentialSecretStore({
      masterKey: "old-provider-master-key",
      keyVersion: "2026-01"
    });
    const record = {
      credentialId: context.credentialId,
      userId: context.userId,
      kind: "oauth_refresh_token" as const,
      secret: legacyStore.encrypt("legacy-refresh-token"),
      createdAt: "2026-05-18T00:00:00.000Z",
      updatedAt: "2026-05-18T00:00:00.000Z"
    };
    const rotatedStore = createProviderCredentialSecretStore({
      masterKey: "new-provider-master-key",
      keyVersion: "2026-02",
      keyring: {
        "2026-01": "old-provider-master-key"
      }
    });
    const result = rotateProviderCredentialSecretRecord({
      store: rotatedStore,
      record,
      context,
      mode: "commit",
      rotatedAt: "2026-05-18T01:00:00.000Z",
      allowLegacyContextFallback: true
    });

    expect(result).toMatchObject({
      mode: "commit",
      action: "rotate",
      reason: "legacy-context",
      previousKeyVersion: "2026-01",
      nextKeyVersion: "2026-02",
      legacyContextFallbackUsed: true
    });
    expect(result.record.secret.keyVersion).toBe("2026-02");
    expect(result.record.secret.contextBinding).toEqual({
      version: "provider-credential-v1",
      digest: expect.any(String)
    });
    expect(rotatedStore.decrypt(result.record.secret, context)).toBe("legacy-refresh-token");
  });
});

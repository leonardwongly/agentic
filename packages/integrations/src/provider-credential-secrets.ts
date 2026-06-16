import crypto from "node:crypto";
import {
  EncryptedSecretEnvelopeSchema,
  ProviderCredentialSecretRecordSchema,
  type EncryptedSecretEnvelope,
  type ProviderCredentialSecretRecord
} from "@agentic/contracts";

const PROVIDER_SECRET_ALGORITHM = "aes-256-gcm";
const PROVIDER_SECRET_KDF = "scrypt";
const PROVIDER_SECRET_IV_BYTES = 12;
const PROVIDER_SECRET_SALT_BYTES = 16;
const PROVIDER_SECRET_DERIVED_KEY_BYTES = 32;
// Legacy fixed KDF salt used by envelopes written before per-record random salts
// were introduced. Retained only so those older envelopes remain decryptable;
// every new envelope now carries its own unique random salt.
const LEGACY_PROVIDER_SECRET_KDF_SALT = "agentic-provider-credentials-v1";
const PROVIDER_SECRET_CONTEXT_BINDING_VERSION = "provider-credential-v1";
const PROVIDER_SECRET_KEYRING_ENV = "AGENTIC_PROVIDER_SECRET_KEYRING";

export class ProviderCredentialSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderCredentialSecretError";
  }
}

export type ProviderCredentialSecretStore = {
  currentKeyVersion: string;
  encrypt(secret: string, context?: ProviderCredentialSecretContext): EncryptedSecretEnvelope;
  decrypt(envelope: EncryptedSecretEnvelope, context?: ProviderCredentialSecretContext): string;
};

export type ProviderCredentialSecretContext = {
  credentialId: string;
  userId: string;
  kind: string;
};

type ProviderCredentialSecretStoreOptions = {
  masterKey?: string;
  keyVersion?: string;
  keyring?: Record<string, string>;
};

type ProviderCredentialSecretDecryptResult = {
  secret: string;
  legacyContextFallbackUsed: boolean;
};

export type ProviderCredentialSecretRotationMode = "dry-run" | "commit";

export type ProviderCredentialSecretRotationResult = {
  mode: ProviderCredentialSecretRotationMode;
  action: "noop" | "rotate";
  reason: "already-current" | "key-version" | "legacy-context" | "context-binding";
  previousKeyVersion: string;
  nextKeyVersion: string;
  legacyContextFallbackUsed: boolean;
  record: ProviderCredentialSecretRecord;
  rotatedRecord: ProviderCredentialSecretRecord | null;
};

function buildSecretAdditionalData(context: ProviderCredentialSecretContext | undefined): Buffer | null {
  if (!context) {
    return null;
  }

  const credentialId = context.credentialId.trim();
  const userId = context.userId.trim();
  const kind = context.kind.trim();

  if (!credentialId || !userId || !kind) {
    throw new ProviderCredentialSecretError("Provider secret context is incomplete.");
  }

  return Buffer.from(
    JSON.stringify({
      credentialId,
      kind,
      userId
    }),
    "utf8"
  );
}

function buildContextBinding(context: ProviderCredentialSecretContext | undefined) {
  const additionalData = buildSecretAdditionalData(context);

  if (!additionalData) {
    return undefined;
  }

  return {
    version: PROVIDER_SECRET_CONTEXT_BINDING_VERSION,
    digest: crypto.createHash("sha256").update(additionalData).digest("base64url")
  };
}

function parseConfiguredKeyring(): Record<string, string> {
  const raw = process.env[PROVIDER_SECRET_KEYRING_ENV]?.trim();

  if (!raw) {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProviderCredentialSecretError(`${PROVIDER_SECRET_KEYRING_ENV} must be a JSON object of key versions to secrets.`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ProviderCredentialSecretError(`${PROVIDER_SECRET_KEYRING_ENV} must be a JSON object of key versions to secrets.`);
  }

  const keyring: Record<string, string> = {};

  for (const [version, secret] of Object.entries(parsed)) {
    if (version.trim().length === 0 || typeof secret !== "string" || secret.trim().length === 0) {
      throw new ProviderCredentialSecretError(`${PROVIDER_SECRET_KEYRING_ENV} contains an invalid key version or secret.`);
    }

    keyring[version.trim()] = secret;
  }

  return keyring;
}

function resolveProviderMasterSecrets(params: { currentKeyVersion: string; currentMasterKey: string; keyring?: Record<string, string> }): Map<string, string> {
  const configured = {
    ...parseConfiguredKeyring(),
    ...(params.keyring ?? {}),
    [params.currentKeyVersion]: params.currentMasterKey
  };
  const masterSecrets = new Map<string, string>();

  for (const [version, secret] of Object.entries(configured)) {
    const normalizedVersion = version.trim();
    const normalizedSecret = secret.trim();

    if (!normalizedVersion || !normalizedSecret) {
      throw new ProviderCredentialSecretError("Provider credential encryption keyring contains an empty key version or secret.");
    }

    masterSecrets.set(normalizedVersion, normalizedSecret);
  }

  return masterSecrets;
}

function decryptWithResult(params: {
  store: ProviderCredentialSecretStore;
  envelope: EncryptedSecretEnvelope;
  context: ProviderCredentialSecretContext;
  allowLegacyContextFallback?: boolean;
}): ProviderCredentialSecretDecryptResult {
  try {
    return {
      secret: params.store.decrypt(params.envelope, params.context),
      legacyContextFallbackUsed: false
    };
  } catch (error) {
    if (!params.allowLegacyContextFallback) {
      throw error;
    }

    try {
      return {
        secret: params.store.decrypt(params.envelope),
        legacyContextFallbackUsed: true
      };
    } catch {
      throw error;
    }
  }
}

export function createProviderCredentialSecretStore(
  options?: ProviderCredentialSecretStoreOptions
): ProviderCredentialSecretStore {
  const masterKey = options?.masterKey ?? process.env.AGENTIC_PROVIDER_SECRET_KEY ?? "";
  const keyVersion = (options?.keyVersion ?? process.env.AGENTIC_PROVIDER_SECRET_KEY_VERSION ?? "v1").trim();

  if (masterKey.trim().length === 0) {
    throw new ProviderCredentialSecretError(
      "Provider credential encryption key is not configured."
    );
  }

  if (keyVersion.length === 0) {
    throw new ProviderCredentialSecretError("Provider credential encryption key version is not configured.");
  }

  const masterSecrets = resolveProviderMasterSecrets({
    currentKeyVersion: keyVersion,
    currentMasterKey: masterKey,
    keyring: options?.keyring
  });
  const derivedKeyCache = new Map<string, Buffer>();

  function resolveDerivedKey(version: string, salt: Buffer): Buffer {
    const masterSecret = masterSecrets.get(version);

    if (!masterSecret) {
      throw new ProviderCredentialSecretError(
        `Provider credential encryption key version ${version} is not configured.`
      );
    }

    const cacheKey = `${version}:${salt.toString("base64")}`;
    let derivedKey = derivedKeyCache.get(cacheKey);

    if (!derivedKey) {
      derivedKey = crypto.scryptSync(masterSecret, salt, PROVIDER_SECRET_DERIVED_KEY_BYTES);
      derivedKeyCache.set(cacheKey, derivedKey);
    }

    return derivedKey;
  }

  return {
    currentKeyVersion: keyVersion,

    encrypt(secret: string, context?: ProviderCredentialSecretContext): EncryptedSecretEnvelope {
      if (secret.length === 0) {
        throw new ProviderCredentialSecretError("Provider secret cannot be empty.");
      }

      if (secret.length > 8_192) {
        throw new ProviderCredentialSecretError("Provider secret exceeds the supported size limit.");
      }

      const iv = crypto.randomBytes(PROVIDER_SECRET_IV_BYTES);
      const salt = crypto.randomBytes(PROVIDER_SECRET_SALT_BYTES);
      const derivedKey = resolveDerivedKey(keyVersion, salt);
      const cipher = crypto.createCipheriv(PROVIDER_SECRET_ALGORITHM, derivedKey, iv);
      const additionalData = buildSecretAdditionalData(context);

      if (additionalData) {
        cipher.setAAD(additionalData);
      }

      const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
      const authTag = cipher.getAuthTag();

      return EncryptedSecretEnvelopeSchema.parse({
        algorithm: PROVIDER_SECRET_ALGORITHM,
        keyVersion,
        kdf: PROVIDER_SECRET_KDF,
        ciphertext: ciphertext.toString("base64"),
        iv: iv.toString("base64"),
        authTag: authTag.toString("base64"),
        salt: salt.toString("base64"),
        contextBinding: buildContextBinding(context)
      });
    },

    decrypt(envelope: EncryptedSecretEnvelope, context?: ProviderCredentialSecretContext): string {
      const validated = EncryptedSecretEnvelopeSchema.parse(envelope);
      const salt = validated.salt
        ? Buffer.from(validated.salt, "base64")
        : Buffer.from(LEGACY_PROVIDER_SECRET_KDF_SALT, "utf8");
      const derivedKey = resolveDerivedKey(validated.keyVersion, salt);

      try {
        const decipher = crypto.createDecipheriv(
          validated.algorithm,
          derivedKey,
          Buffer.from(validated.iv, "base64")
        );
        const additionalData = buildSecretAdditionalData(context);

        if (additionalData) {
          decipher.setAAD(additionalData);
        }

        decipher.setAuthTag(Buffer.from(validated.authTag, "base64"));

        const plaintext = Buffer.concat([
          decipher.update(Buffer.from(validated.ciphertext, "base64")),
          decipher.final()
        ]).toString("utf8");

        if (plaintext.length === 0) {
          throw new ProviderCredentialSecretError("Provider secret cannot be empty.");
        }

        return plaintext;
      } catch {
        throw new ProviderCredentialSecretError("Provider secret decryption failed.");
      }
    }
  };
}

export function decryptProviderCredentialSecret(params: {
  store: ProviderCredentialSecretStore;
  envelope: EncryptedSecretEnvelope;
  context: ProviderCredentialSecretContext;
  allowLegacyContextFallback?: boolean;
}): string {
  return decryptWithResult(params).secret;
}

export function rotateProviderCredentialSecretRecord(params: {
  store: ProviderCredentialSecretStore;
  record: ProviderCredentialSecretRecord;
  context: ProviderCredentialSecretContext;
  mode: ProviderCredentialSecretRotationMode;
  rotatedAt: string;
  allowLegacyContextFallback?: boolean;
}): ProviderCredentialSecretRotationResult {
  const record = ProviderCredentialSecretRecordSchema.parse(params.record);
  const decryptResult = decryptWithResult({
    store: params.store,
    envelope: record.secret,
    context: params.context,
    allowLegacyContextFallback: params.allowLegacyContextFallback
  });
  const previousKeyVersion = record.secret.keyVersion;
  const nextKeyVersion = params.store.currentKeyVersion;
  const keyVersionChanged = previousKeyVersion !== nextKeyVersion;
  const legacyContextFallbackUsed = decryptResult.legacyContextFallbackUsed;
  const contextBindingMissing = !record.secret.contextBinding;
  const shouldRotate = keyVersionChanged || legacyContextFallbackUsed || contextBindingMissing;

  if (!shouldRotate) {
    return {
      mode: params.mode,
      action: "noop",
      reason: "already-current",
      previousKeyVersion,
      nextKeyVersion,
      legacyContextFallbackUsed,
      record,
      rotatedRecord: null
    };
  }

  const rotatedRecord = ProviderCredentialSecretRecordSchema.parse({
    ...record,
    secret: params.store.encrypt(decryptResult.secret, params.context),
    updatedAt: params.rotatedAt
  });

  return {
    mode: params.mode,
    action: "rotate",
    reason: legacyContextFallbackUsed ? "legacy-context" : keyVersionChanged ? "key-version" : "context-binding",
    previousKeyVersion,
    nextKeyVersion,
    legacyContextFallbackUsed,
    record: params.mode === "commit" ? rotatedRecord : record,
    rotatedRecord
  };
}

import crypto from "node:crypto";
import {
  EncryptedSecretEnvelopeSchema,
  type EncryptedSecretEnvelope
} from "@agentic/contracts";

const PROVIDER_SECRET_ALGORITHM = "aes-256-gcm";
const PROVIDER_SECRET_KDF = "scrypt";
const PROVIDER_SECRET_IV_BYTES = 12;
const PROVIDER_SECRET_DERIVED_KEY_BYTES = 32;
const PROVIDER_SECRET_KDF_SALT = "agentic-provider-credentials-v1";

export class ProviderCredentialSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderCredentialSecretError";
  }
}

export type ProviderCredentialSecretStore = {
  encrypt(secret: string, context?: ProviderCredentialSecretContext): EncryptedSecretEnvelope;
  decrypt(envelope: EncryptedSecretEnvelope, context?: ProviderCredentialSecretContext): string;
};

export type ProviderCredentialSecretContext = {
  credentialId: string;
  userId: string;
  kind: string;
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

export function createProviderCredentialSecretStore(options?: {
  masterKey?: string;
  keyVersion?: string;
}): ProviderCredentialSecretStore {
  const masterKey = options?.masterKey ?? process.env.AGENTIC_PROVIDER_SECRET_KEY ?? "";
  const keyVersion = options?.keyVersion ?? process.env.AGENTIC_PROVIDER_SECRET_KEY_VERSION ?? "v1";

  if (masterKey.trim().length === 0) {
    throw new ProviderCredentialSecretError(
      "Provider credential encryption key is not configured."
    );
  }

  const derivedKey = crypto.scryptSync(
    masterKey,
    PROVIDER_SECRET_KDF_SALT,
    PROVIDER_SECRET_DERIVED_KEY_BYTES
  );

  return {
    encrypt(secret: string, context?: ProviderCredentialSecretContext): EncryptedSecretEnvelope {
      if (secret.length === 0) {
        throw new ProviderCredentialSecretError("Provider secret cannot be empty.");
      }

      if (secret.length > 8_192) {
        throw new ProviderCredentialSecretError("Provider secret exceeds the supported size limit.");
      }

      const iv = crypto.randomBytes(PROVIDER_SECRET_IV_BYTES);
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
        authTag: authTag.toString("base64")
      });
    },

    decrypt(envelope: EncryptedSecretEnvelope, context?: ProviderCredentialSecretContext): string {
      const validated = EncryptedSecretEnvelopeSchema.parse(envelope);

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
}): string {
  try {
    return params.store.decrypt(params.envelope, params.context);
  } catch (error) {
    try {
      return params.store.decrypt(params.envelope);
    } catch {
      throw error;
    }
  }
}

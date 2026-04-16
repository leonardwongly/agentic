import { google, type Auth } from "googleapis";
import { z } from "zod";

const GoogleOAuthTokenResultSchema = z.object({
  accessToken: z.string().min(1).nullable(),
  refreshToken: z.string().min(1).nullable(),
  expiryDate: z.string().datetime().nullable(),
  scopes: z.array(z.string().min(1))
});

const GoogleAccountProfileSchema = z.object({
  sub: z.string().min(1),
  email: z.string().trim().email(),
  name: z.string().trim().min(1).default("Google account"),
  picture: z.string().trim().url().nullable().default(null)
});

export type GoogleOAuthTokenResult = z.infer<typeof GoogleOAuthTokenResultSchema>;
export type GoogleAccountProfile = z.infer<typeof GoogleAccountProfileSchema>;

export const GOOGLE_PROVIDER_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar"
] as const;

function getGoogleClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
  }

  return {
    clientId,
    clientSecret
  };
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

export function createGoogleOAuthClient(params?: {
  redirectUri?: string;
  refreshToken?: string;
  accessToken?: string;
}): Auth.OAuth2Client {
  const credentials = getGoogleClientCredentials();
  const oauth2 = new google.auth.OAuth2(credentials.clientId, credentials.clientSecret, params?.redirectUri);

  if (params?.refreshToken || params?.accessToken) {
    oauth2.setCredentials({
      refresh_token: params.refreshToken ?? undefined,
      access_token: params.accessToken ?? undefined
    });
  }

  return oauth2;
}

export function buildGoogleAuthorizationUrl(params: {
  redirectUri: string;
  state: string;
  loginHint?: string;
  scopes?: readonly string[];
}): string {
  const oauth2 = createGoogleOAuthClient({ redirectUri: params.redirectUri });
  return oauth2.generateAuthUrl({
    access_type: "offline",
    include_granted_scopes: true,
    prompt: "consent",
    response_type: "code",
    scope: [...(params.scopes ?? GOOGLE_PROVIDER_SCOPES)],
    state: params.state,
    login_hint: params.loginHint
  });
}

export async function exchangeGoogleAuthorizationCode(params: {
  code: string;
  redirectUri: string;
}): Promise<GoogleOAuthTokenResult> {
  const oauth2 = createGoogleOAuthClient({ redirectUri: params.redirectUri });
  const response = await oauth2.getToken(params.code);
  const tokens = response.tokens;

  oauth2.setCredentials(tokens);

  return GoogleOAuthTokenResultSchema.parse({
    accessToken: tokens.access_token ?? null,
    refreshToken: tokens.refresh_token ?? null,
    expiryDate: typeof tokens.expiry_date === "number" ? new Date(tokens.expiry_date).toISOString() : null,
    scopes: typeof tokens.scope === "string" ? tokens.scope.split(/\s+/u).map((scope) => scope.trim()).filter(Boolean) : []
  });
}

export async function fetchGoogleAccountProfile(params: {
  refreshToken?: string;
  accessToken?: string;
  redirectUri?: string;
}): Promise<GoogleAccountProfile> {
  const oauth2 = createGoogleOAuthClient(params);
  const oauth2Api = google.oauth2({ version: "v2", auth: oauth2 });
  const profile = await oauth2Api.userinfo.get();

  return GoogleAccountProfileSchema.parse({
    sub: profile.data.id,
    email: profile.data.email,
    name: profile.data.name ?? "Google account",
    picture: profile.data.picture ?? null
  });
}

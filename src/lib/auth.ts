import { z } from "zod";

export const authStorageKey = "pluto-google-auth-v1";

const payloadSchema = z.object({
  email: z.string().email(),
  exp: z.number(),
  name: z.string().optional(),
  picture: z.string().optional()
});

export type AuthSession = {
  token: string;
  email: string;
  name?: string;
  picture?: string;
  exp: number;
};

export function googleClientId(): string {
  const value = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim();
  if (!value) throw new Error("Google sign-in is not configured. Set NEXT_PUBLIC_GOOGLE_CLIENT_ID and rebuild the website.");
  return value;
}

function decodeBase64Url(part: string): string {
  const base64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function isAuthSessionValid(session: AuthSession | null | undefined, nowMs = Date.now()): session is AuthSession {
  return Boolean(session && session.token && session.exp * 1000 > nowMs + 30_000);
}

export function parseGoogleCredential(token: string, nowMs = Date.now()): AuthSession {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) throw new Error("Invalid Google sign-in token.");
  const payload = payloadSchema.parse(JSON.parse(decodeBase64Url(parts[1])));
  const session: AuthSession = {
    token,
    email: payload.email,
    name: payload.name,
    picture: payload.picture,
    exp: payload.exp
  };
  if (!isAuthSessionValid(session, nowMs)) throw new Error("Your Google session expired. Please sign in again.");
  return session;
}

export function restoreAuthSession(raw: string, nowMs = Date.now()): AuthSession | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || !parsed || !("token" in parsed) || typeof parsed.token !== "string") return null;
    return parseGoogleCredential(parsed.token, nowMs);
  } catch {
    return null;
  }
}

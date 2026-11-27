import { afterEach, describe, expect, it, vi } from "vitest";
import { OAuth2Client } from "google-auth-library";
import { googleClientId, isAuthSessionValid, parseGoogleCredential, restoreAuthSession } from "@/lib/auth";
import { verifyGoogleToken } from "@api/server/auth";

function makeJwt(payload: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("frontend Google auth helpers", () => {
  it("requires NEXT_PUBLIC_GOOGLE_CLIENT_ID", () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "");
    expect(() => googleClientId()).toThrow();
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "12345.apps.googleusercontent.com");
    expect(googleClientId()).toBe("12345.apps.googleusercontent.com");
  });

  it("parses valid Google ID token payloads including Unicode names and rejects expired tokens", () => {
    const now = 1_700_000_000_000;
    const token = makeJwt({ email: "jose@example.com", name: "José Reader", exp: Math.floor(now / 1000) + 3600 });
    const session = parseGoogleCredential(token, now);
    expect(session).toMatchObject({ token, email: "jose@example.com", name: "José Reader" });
    expect(isAuthSessionValid(session, now)).toBe(true);
    expect(restoreAuthSession(JSON.stringify(session), now)).toEqual(session);

    const expired = makeJwt({ email: "jose@example.com", exp: Math.floor(now / 1000) + 10 });
    expect(() => parseGoogleCredential(expired, now)).toThrow("expired");
    expect(restoreAuthSession(JSON.stringify({ token: expired }), now)).toBeNull();
  });
});

describe("backend Google token verifier", () => {
  it("accepts verified Google tokens and rejects unverified emails", async () => {
    const spy = vi.spyOn(OAuth2Client.prototype, "verifyIdToken").mockResolvedValueOnce({
      getPayload: () => ({ sub: "sub-1", email: "user@gmail.com", email_verified: true, name: "Any User" })
    } as never);
    await expect(verifyGoogleToken("tok", "client-id")).resolves.toEqual({
      sub: "sub-1",
      email: "user@gmail.com",
      name: "Any User",
      picture: undefined
    });
    expect(spy).toHaveBeenCalledWith({ idToken: "tok", audience: "client-id" });

    spy.mockResolvedValueOnce({
      getPayload: () => ({ sub: "sub-2", email: "user@gmail.com", email_verified: false })
    } as never);
    await expect(verifyGoogleToken("tok", "client-id")).rejects.toThrow("Invalid Google account token");
  });
});

import { OAuth2Client } from "google-auth-library";

export type AuthenticatedUser = {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
};

const client = new OAuth2Client();

export async function verifyGoogleToken(token: string, clientId: string): Promise<AuthenticatedUser> {
  const ticket = await client.verifyIdToken({ idToken: token, audience: clientId });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email || payload.email_verified !== true) {
    throw new Error("Invalid Google account token.");
  }
  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name,
    picture: payload.picture
  };
}

import { apiUrl } from "./api";
import { profileRequestSchema, type ProfileRequest, type ProfileResponse } from "./contract";

const profileKey = (email: string) => `pluto-profile-v1:${email.toLowerCase()}`;

export function readCachedProfile(email: string): ProfileRequest | null {
  try {
    const parsed = profileRequestSchema.safeParse(JSON.parse(localStorage.getItem(profileKey(email)) ?? "null"));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

export function cacheProfile(email: string, profile: ProfileRequest): void {
  try { localStorage.setItem(profileKey(email), JSON.stringify(profile)); } catch { /* The server copy is authoritative. */ }
}

/** Resolves to null when the profile cannot be checked, so a failing analytics backend never blocks the app. */
export async function fetchProfile(token: string): Promise<ProfileResponse | null> {
  try {
    const response = await fetch(apiUrl("profile"), { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return null;
    const data = await response.json() as Partial<ProfileResponse>;
    return { completed: data.completed === true, role: data.role, ageBand: data.ageBand };
  } catch { return null; }
}

export async function submitProfile(token: string, profile: ProfileRequest): Promise<void> {
  const response = await fetch(apiUrl("profile"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(profile)
  });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new Error(typeof data === "object" && data && "error" in data && typeof data.error === "string" ? data.error : "Your profile could not be saved.");
  }
}

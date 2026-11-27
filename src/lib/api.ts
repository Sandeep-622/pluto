export function apiUrl(path: "chat" | "health"): string {
  const value = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!value) throw new Error("The API address is not configured. Set NEXT_PUBLIC_API_BASE_URL and rebuild the website.");
  let base: URL;
  try { base = new URL(value); } catch { throw new Error("The configured API address is invalid."); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  if (base.username || base.password || base.search || base.hash || (base.pathname !== "/" && base.pathname !== "") || (base.protocol !== "https:" && !(loopback && base.protocol === "http:"))) {
    throw new Error("Use an HTTPS API origin without credentials or a path, or a loopback HTTP origin for local testing.");
  }
  return `${base.origin}/api/${path}`;
}

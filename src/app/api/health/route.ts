import { getConfig } from "@/lib/server/config";

export const dynamic = "force-dynamic";
export function GET() {
  try {
    const config = getConfig();
    return Response.json({ status: config.CHAT_ENABLED === "true" ? "ok" : "paused", webAvailable: config.ENABLE_WEB_SEARCH === "true" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "unconfigured", webAvailable: false }, { status: 503 });
  }
}

import { app } from "@azure/functions";
import { appendFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { createHandlers } from "../../api/src/http";
import { reserveRequest } from "../../api/src/server/limits";

globalThis.fetch = () => Promise.reject(new Error("External provider calls are forbidden in the test host."));
const record = (event: string) => appendFileSync(new URL("./events.jsonl", import.meta.url), `${JSON.stringify({ event })}\n`);
const handlers = createHandlers({
  getConfig: () => ({ CHAT_ENABLED: "true", ENABLE_WEB_SEARCH: "true", GOOGLE_CLIENT_ID: "test-google-client-id" }),
  reserveRequest,
  async verifyAuth(token) {
    if (token === "test-google-token") return { sub: "test-user", email: "test@example.com", name: "Test Reader" };
    const parts = token.split(".");
    if (parts.length === 3 && parts[2] === "pluto-test-sig") {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { sub?: string; email?: string; name?: string; email_verified?: boolean; exp?: number };
      if (payload.sub && payload.email && payload.email_verified === true && typeof payload.exp === "number" && payload.exp * 1000 > Date.now()) {
        return { sub: payload.sub, email: payload.email, name: payload.name };
      }
    }
    throw new Error("Invalid test token");
  },
  async runChat(request, emit, signal, onMetrics) {
    record("started");
    signal.addEventListener("abort", () => record("aborted"), { once: true });
    if (request.question === "fail") throw new Error("Simulated provider failure");
    if (request.includeWeb) {
      emit({ type: "start", section: "web" });
      emit({ type: "delta", section: "web", text: "A deterministic website finding from the test fixture." });
      emit({ type: "sources", section: "web", sources: [{ kind: "web", id: "W1", title: "Mock website", url: "https://example.test/medical" }] });
      emit({ type: "section-done", section: "web" });
    }
    emit({ type: "start", section: "books" });
    emit({ type: "delta", section: "books", text: "Local Functions streaming is working. [B1]" });
    await delay(request.question === "slow" ? 3000 : 350, undefined, { signal });
    onMetrics?.({ bookHits: 1, inputTokens: 120, outputTokens: 45 });
    emit({ type: "sources", section: "books", sources: [{ kind: "books", id: "B1", title: "Local mock book" }] });
    emit({ type: "section-done", section: "books" });
    emit({ type: "done" });
    record("finished");
  }
});

app.setup({ enableHttpStream: true });
app.http("chat", { route: "chat", methods: ["POST", "OPTIONS"], authLevel: "anonymous", handler: handlers.chat });
app.http("feedback", { route: "feedback", methods: ["POST", "OPTIONS"], authLevel: "anonymous", handler: handlers.feedback });
app.http("profile", { route: "profile", methods: ["GET", "POST", "OPTIONS"], authLevel: "anonymous", handler: handlers.profile });
app.http("track", { route: "track", methods: ["POST", "OPTIONS"], authLevel: "anonymous", handler: handlers.track });
app.http("health", {
  route: "health", methods: ["GET", "OPTIONS"], authLevel: "anonymous",
  async handler(request) {
    const response = await handlers.health(request);
    const headers = new Headers(response.headers);
    headers.set("X-Pluto-Test-Host", "true");
    return { ...response, headers };
  }
});

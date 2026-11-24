import { app } from "@azure/functions";
import { appendFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { createHandlers } from "../../api/src/http";
import { reserveRequest } from "../../api/src/server/limits";

globalThis.fetch = () => Promise.reject(new Error("External provider calls are forbidden in the test host."));
const record = (event: string) => appendFileSync(new URL("./events.jsonl", import.meta.url), `${JSON.stringify({ event })}\n`);
const handlers = createHandlers({
  getConfig: () => ({ CHAT_ENABLED: "true", ENABLE_WEB_SEARCH: "true" }),
  reserveRequest,
  async runChat(request, emit, signal) {
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
    emit({ type: "sources", section: "books", sources: [{ kind: "books", id: "B1", title: "Local mock book" }] });
    emit({ type: "section-done", section: "books" });
    emit({ type: "done" });
    record("finished");
  }
});

app.setup({ enableHttpStream: true });
app.http("chat", { route: "chat", methods: ["POST", "OPTIONS"], authLevel: "anonymous", handler: handlers.chat });
app.http("health", {
  route: "health", methods: ["GET", "OPTIONS"], authLevel: "anonymous",
  async handler(request) {
    const response = await handlers.health(request);
    const headers = new Headers(response.headers);
    headers.set("X-Pluto-Test-Host", "true");
    return { ...response, headers };
  }
});

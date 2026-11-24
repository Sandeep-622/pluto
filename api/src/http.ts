import type { HttpRequest, HttpResponseInit } from "@azure/functions";
import { ReadableStream } from "node:stream/web";
import { chatRequestSchema, type ChatEvent } from "../../src/lib/contract";
import { getConfig } from "./server/config";
import { reserveRequest } from "./server/limits";
import { runChat } from "./server/chat";

type Dependencies = {
  getConfig: () => { CHAT_ENABLED: "true" | "false"; ENABLE_WEB_SEARCH: "true" | "false" };
  reserveRequest: typeof reserveRequest;
  runChat: typeof runChat;
};

function originHeaders(request: HttpRequest): { headers: Record<string, string> } | { response: HttpResponseInit } {
  const allowed = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!allowed.length || allowed.some((value) => {
    try {
      const url = new URL(value);
      return url.origin !== value || !(url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
    } catch { return true; }
  })) {
    console.error("Invalid API configuration: ALLOWED_ORIGINS");
    return { response: { status: 503, jsonBody: { error: "The API origins are not configured. Contact the demo administrator." } } };
  }
  const origin = request.headers.get("origin");
  if (origin && !allowed.includes(origin)) return { response: { status: 403, jsonBody: { error: "This website is not allowed to call the demo." } } };
  return { headers: {
    "Cache-Control": "no-store, no-transform",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin",
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {})
  } };
}

async function readBody(request: HttpRequest) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Request body is required.");
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 65536) {
        await reader.cancel();
        throw new Error("Request body exceeds the demo limit.");
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally { reader.releaseLock(); }
}

export function createHandlers(dependencies: Dependencies = { getConfig, reserveRequest, runChat }) {
  async function handle(request: HttpRequest, chat: boolean): Promise<HttpResponseInit> {
    const result = originHeaders(request);
    if ("response" in result) return result.response;
    const { headers } = result;
    if (request.method === "OPTIONS") {
      const method = request.headers.get("access-control-request-method");
      const requestedHeaders = request.headers.get("access-control-request-headers")?.split(",").map((value) => value.trim().toLowerCase()) ?? [];
      if ((method && method !== (chat ? "POST" : "GET")) || requestedHeaders.some((value) => value !== "content-type")) {
        return { status: 403, headers, jsonBody: { error: "This cross-origin request is not allowed." } };
      }
      return { status: 204, headers: { ...headers, "Access-Control-Allow-Methods": chat ? "POST, OPTIONS" : "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600" } };
    }
    if (request.method !== (chat ? "POST" : "GET")) return { status: 405, headers, jsonBody: { error: "This method is not supported." } };
    let config;
    try { config = dependencies.getConfig(); } catch {
      return { status: 503, headers, jsonBody: chat ? { error: "The server is not configured. Contact the demo administrator." } : { status: "unconfigured", webAvailable: false } };
    }
    if (!chat) return { headers, jsonBody: { status: config.CHAT_ENABLED === "true" ? "ok" : "paused", webAvailable: config.ENABLE_WEB_SEARCH === "true" } };
    if (config.CHAT_ENABLED !== "true") return { status: 503, headers, jsonBody: { error: "This demo is paused by its administrator." } };
    if (!request.headers.get("content-type")?.includes("application/json")) return { status: 415, headers, jsonBody: { error: "Send a JSON request." } };
    let raw: unknown;
    try { raw = await readBody(request); } catch {
      return { status: 400, headers, jsonBody: { error: "The request is missing, invalid, or too large. Shorten it or start a new chat." } };
    }
    const parsed = chatRequestSchema.safeParse(raw);
    if (!parsed.success) return { status: 400, headers, jsonBody: { error: "Enter a question of 1-2,000 characters and at most six recent messages." } };
    const reservation = dependencies.reserveRequest();
    if (!reservation) return { status: 429, headers: { ...headers, "Retry-After": "60" }, jsonBody: { error: "This small demo is busy. Please wait a minute and try again." } };
    let released = false;
    const release = () => { if (!released) { released = true; reservation(); } };
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(190000)]);
    const encoder = new TextEncoder();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      async start(output) {
        const emit = (event: ChatEvent) => { if (!signal.aborted) output.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); };
        try { await dependencies.runChat(parsed.data, emit, signal); }
        catch (error) {
          if (!signal.aborted) {
            console.error("Chat stream failed", { type: error instanceof Error ? error.name : "unknown" });
            emit({ type: "error", section: "books", message: "The connection ended before the answer finished. Please retry." });
          }
        } finally {
          release();
          if (!cancelled) output.close();
        }
      },
      cancel() { cancelled = true; controller.abort(); release(); }
    });
    return { headers: { ...headers, "Content-Type": "application/x-ndjson; charset=utf-8", "X-Accel-Buffering": "no" }, body };
  }
  return {
    chat: (request: HttpRequest) => handle(request, true),
    health: (request: HttpRequest) => handle(request, false)
  };
}

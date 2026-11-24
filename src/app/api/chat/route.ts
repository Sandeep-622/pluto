import { chatRequestSchema, type ChatEvent } from "@/lib/contract";
import { getConfig } from "@/lib/server/config";
import { reserveRequest } from "@/lib/server/limits";
import { runChat } from "@/lib/server/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readBody(request: Request) {
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
        throw new Error("Request is too large. Start a new chat or shorten your question.");
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return Response.json({ error: "Send a JSON request." }, { status: 415 });
  }
  try {
    if (getConfig().CHAT_ENABLED !== "true") {
      return Response.json({ error: "This demo is paused by its administrator." }, { status: 503 });
    }
  } catch {
    return Response.json({ error: "The server is not configured. Contact the demo administrator." }, { status: 503 });
  }
  let raw: unknown;
  try { raw = await readBody(request); } catch {
    return Response.json({ error: "The request is missing, invalid, or too large. Shorten it or start a new chat." }, { status: 400 });
  }
  const parsed = chatRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Enter a question of 1-2,000 characters and at most six recent messages." }, { status: 400 });
  }
  // App Service sets X-ARR-ClientIP; other hosts share a conservative process bucket.
  const visitor = process.env.WEBSITE_INSTANCE_ID ? (request.headers.get("x-arr-clientip") ?? "shared") : "local";
  const release = reserveRequest(visitor);
  if (!release) {
    return Response.json({ error: "This small demo is busy. Please wait a minute and try again." }, { status: 429, headers: { "Retry-After": "60" } });
  }
  const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(190000)]);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(output) {
      const emit = (event: ChatEvent) => {
        if (!signal.aborted) output.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        await runChat(parsed.data, emit, signal);
      } catch (error) {
        if (!signal.aborted) {
          console.error("Chat stream failed", { type: error instanceof Error ? error.name : "unknown" });
          emit({ type: "error", section: "books", message: "The connection ended before the answer finished. Please retry." });
        }
      } finally {
        release();
        if (!controller.signal.aborted) output.close();
      }
    },
    cancel() { controller.abort(); release(); }
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Content-Type-Options": "nosniff",
      "X-Accel-Buffering": "no"
    }
  });
}

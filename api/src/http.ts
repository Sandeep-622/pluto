import type { HttpRequest, HttpResponseInit } from "@azure/functions";
import { ReadableStream } from "node:stream/web";
import { chatRequestSchema, feedbackRequestSchema, profileRequestSchema, trackRequestSchema, type ChatEvent } from "../../src/lib/contract";
import { getConfig } from "./server/config";
import { reserveRequest } from "./server/limits";
import { runChat, type ChatMetrics } from "./server/chat";
import { verifyGoogleToken, type AuthenticatedUser } from "./server/auth";
import { getProfile, recordChatAnalytics, recordFeedback, recordTrack, saveProfile } from "./server/analytics";

type Kind = "chat" | "health" | "feedback" | "profile" | "track";

type Dependencies = {
  getConfig: () => {
    CHAT_ENABLED: "true" | "false";
    ENABLE_WEB_SEARCH: "true" | "false";
    GOOGLE_CLIENT_ID: string;
  };
  reserveRequest: typeof reserveRequest;
  runChat: typeof runChat;
  verifyAuth?: typeof verifyGoogleToken;
  recordAnalytics?: typeof recordChatAnalytics;
  recordFeedback?: typeof recordFeedback;
  getProfile?: typeof getProfile;
  saveProfile?: typeof saveProfile;
  recordTrack?: typeof recordTrack;
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

export function createHandlers(dependencies: Dependencies = {
  getConfig,
  reserveRequest,
  runChat,
  verifyAuth: verifyGoogleToken,
  recordAnalytics: recordChatAnalytics,
  recordFeedback
}) {
  const verifyAuth = dependencies.verifyAuth ?? verifyGoogleToken;
  const recordAnalytics = dependencies.recordAnalytics ?? recordChatAnalytics;
  const saveFeedback = dependencies.recordFeedback ?? recordFeedback;
  const readProfile = dependencies.getProfile ?? getProfile;
  const writeProfile = dependencies.saveProfile ?? saveProfile;
  const track = dependencies.recordTrack ?? recordTrack;

  async function authenticate(request: HttpRequest, clientId: string, headers: Record<string, string>): Promise<{ user: AuthenticatedUser } | { response: HttpResponseInit }> {
    const authorization = request.headers.get("authorization");
    const match = authorization?.match(/^Bearer\s+(\S+)$/i);
    if (!match) return { response: { status: 401, headers, jsonBody: { error: "Sign in with Google to ask a question." } } };
    try {
      return { user: await verifyAuth(match[1], clientId) };
    } catch {
      return { response: { status: 401, headers, jsonBody: { error: "Your Google session expired or is invalid. Please sign in again." } } };
    }
  }

  async function authenticatedJson(request: HttpRequest, clientId: string, headers: Record<string, string>, invalid: string): Promise<{ user: AuthenticatedUser; raw: unknown } | { response: HttpResponseInit }> {
    const authResult = await authenticate(request, clientId, headers);
    if ("response" in authResult) return authResult;
    if (!request.headers.get("content-type")?.includes("application/json")) return { response: { status: 415, headers, jsonBody: { error: "Send a JSON request." } } };
    try {
      return { user: authResult.user, raw: await readBody(request) };
    } catch {
      return { response: { status: 400, headers, jsonBody: { error: invalid } } };
    }
  }

  async function handle(request: HttpRequest, kind: Kind): Promise<HttpResponseInit> {
    const result = originHeaders(request);
    if ("response" in result) return result.response;
    const { headers } = result;
    const allowedMethods = kind === "health" ? ["GET"] : kind === "profile" ? ["GET", "POST"] : ["POST"];
    const needsAuthHeaders = kind !== "health";
    if (request.method === "OPTIONS") {
      const method = request.headers.get("access-control-request-method");
      const requestedHeaders = request.headers.get("access-control-request-headers")?.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean) ?? [];
      const allowedHeaders = needsAuthHeaders ? ["content-type", "authorization"] : ["content-type"];
      if ((method && !allowedMethods.includes(method)) || requestedHeaders.some((value) => !allowedHeaders.includes(value))) {
        return { status: 403, headers, jsonBody: { error: "This cross-origin request is not allowed." } };
      }
      return { status: 204, headers: { ...headers, "Access-Control-Allow-Methods": `${allowedMethods.join(", ")}, OPTIONS`, "Access-Control-Allow-Headers": needsAuthHeaders ? "Content-Type, Authorization" : "Content-Type", "Access-Control-Max-Age": "600" } };
    }
    if (!allowedMethods.includes(request.method)) return { status: 405, headers, jsonBody: { error: "This method is not supported." } };
    let config;
    try { config = dependencies.getConfig(); } catch {
      return { status: 503, headers, jsonBody: kind !== "health" ? { error: "The server is not configured. Contact the demo administrator." } : { status: "unconfigured", webAvailable: false } };
    }
    if (kind === "health") return { headers, jsonBody: { status: config.CHAT_ENABLED === "true" ? "ok" : "paused", webAvailable: config.ENABLE_WEB_SEARCH === "true" } };

    if (kind === "profile" && request.method === "GET") {
      const authResult = await authenticate(request, config.GOOGLE_CLIENT_ID, headers);
      if ("response" in authResult) return authResult.response;
      const profile = await readProfile({ sub: authResult.user.sub, email: authResult.user.email });
      if (!profile) return { status: 503, headers, jsonBody: { error: "Your profile could not be loaded." } };
      return { status: 200, headers, jsonBody: profile };
    }

    if (kind === "profile" || kind === "track" || kind === "feedback") {
      const input = await authenticatedJson(request, config.GOOGLE_CLIENT_ID, headers, `Invalid ${kind} request.`);
      if ("response" in input) return input.response;
      const user = { sub: input.user.sub, email: input.user.email };
      if (kind === "profile") {
        const parsed = profileRequestSchema.safeParse(input.raw);
        if (!parsed.success) return { status: 400, headers, jsonBody: { error: "Choose a role and an age range." } };
        if (!await writeProfile(user, parsed.data)) return { status: 503, headers, jsonBody: { error: "Your profile could not be saved. Please try again." } };
        return { status: 200, headers, jsonBody: { completed: true, ...parsed.data } };
      }
      if (kind === "track") {
        const parsed = trackRequestSchema.safeParse(input.raw);
        if (!parsed.success) return { status: 400, headers, jsonBody: { error: "Invalid tracking payload." } };
        await track(user, parsed.data);
        return { status: 204, headers };
      }
      const parsed = feedbackRequestSchema.safeParse(input.raw);
      if (!parsed.success) return { status: 400, headers, jsonBody: { error: "Invalid feedback payload." } };
      await saveFeedback({
        userSub: user.sub,
        userEmail: user.email,
        messageId: parsed.data.messageId,
        feedback: parsed.data.feedback,
        includeWeb: parsed.data.includeWeb,
        reason: parsed.data.reason,
        sessionId: parsed.data.sessionId,
        conversationId: parsed.data.conversationId
      });
      return { status: 200, headers, jsonBody: { ok: true, feedback: parsed.data.feedback } };
    }

    if (config.CHAT_ENABLED !== "true") return { status: 503, headers, jsonBody: { error: "This demo is paused by its administrator." } };
    const authResult = await authenticate(request, config.GOOGLE_CLIENT_ID, headers);
    if ("response" in authResult) return authResult.response;
    const { user } = authResult;

    if (!request.headers.get("content-type")?.includes("application/json")) return { status: 415, headers, jsonBody: { error: "Send a JSON request." } };
    let raw: unknown;
    try { raw = await readBody(request); } catch {
      return { status: 400, headers, jsonBody: { error: "The request is missing, invalid, or too large. Shorten it or start a new chat." } };
    }
    const parsed = chatRequestSchema.safeParse(raw);
    if (!parsed.success) return { status: 400, headers, jsonBody: { error: "Enter a question of 1-2,000 characters and at most six recent messages." } };
    const reservation = dependencies.reserveRequest(user.sub);
    if (!reservation) return { status: 429, headers: { ...headers, "Retry-After": "60" }, jsonBody: { error: "This small demo is busy. Please wait a minute and try again." } };
    let released = false;
    const release = () => { if (!released) { released = true; reservation(); } };
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(190000)]);
    const encoder = new TextEncoder();
    const startedAt = Date.now();
    const metrics: ChatMetrics = { bookHits: 0, inputTokens: 0, outputTokens: 0 };
    let hadError = false;
    let cancelled = false;
    let firstTokenAt: number | undefined;
    let answerChars = 0;
    let webHits = 0;
    const errorSections = new Set<string>();
    const body = new ReadableStream<Uint8Array>({
      async start(output) {
        const emit = (event: ChatEvent) => {
          if (event.type === "error") { hadError = true; errorSections.add(event.section); }
          if (event.type === "delta") { firstTokenAt ??= Date.now(); answerChars += event.text.length; }
          if (event.type === "sources" && event.section === "web") webHits = event.sources.length;
          if (!signal.aborted) output.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };
        try {
          await dependencies.runChat(parsed.data, emit, signal, (update) => {
            if (typeof update.bookHits === "number") metrics.bookHits = update.bookHits;
            if (typeof update.inputTokens === "number") metrics.inputTokens = update.inputTokens;
            if (typeof update.outputTokens === "number") metrics.outputTokens = update.outputTokens;
          });
        } catch (error) {
          hadError = true;
          if (!signal.aborted) {
            console.error("Chat stream failed", { type: error instanceof Error ? error.name : "unknown" });
            emit({ type: "error", section: "books", message: "The connection ended before the answer finished. Please retry." });
          }
        } finally {
          release();
          await recordAnalytics({
            userSub: user.sub,
            userEmail: user.email,
            includeWeb: parsed.data.includeWeb,
            questionLength: parsed.data.question.length,
            historyCount: parsed.data.history.length,
            status: signal.aborted ? "aborted" : hadError ? "error" : "complete",
            durationMs: Date.now() - startedAt,
            bookHits: metrics.bookHits,
            inputTokens: metrics.inputTokens,
            outputTokens: metrics.outputTokens,
            messageId: parsed.data.messageId,
            sessionId: parsed.data.sessionId,
            conversationId: parsed.data.conversationId,
            webHits,
            answerChars,
            timeToFirstTokenMs: firstTokenAt === undefined ? undefined : firstTokenAt - startedAt,
            noEvidence: metrics.bookHits === 0 && !errorSections.has("books") && !signal.aborted,
            errorSections: [...errorSections].sort().join(","),
            deployment: process.env.AZURE_OPENAI_CHAT_DEPLOYMENT
          });
          if (!cancelled) output.close();
        }
      },
      cancel() { cancelled = true; controller.abort(); release(); }
    });
    return { headers: { ...headers, "Content-Type": "application/x-ndjson; charset=utf-8", "X-Accel-Buffering": "no" }, body };
  }
  return {
    chat: (request: HttpRequest) => handle(request, "chat"),
    health: (request: HttpRequest) => handle(request, "health"),
    feedback: (request: HttpRequest) => handle(request, "feedback"),
    profile: (request: HttpRequest) => handle(request, "profile"),
    track: (request: HttpRequest) => handle(request, "track")
  };
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpRequest, HttpResponse } from "@azure/functions";
import { createHandlers } from "@api/http";
import type { ProfileResponse } from "../src/lib/contract";

const config = (): { CHAT_ENABLED: "true" | "false"; ENABLE_WEB_SEARCH: "true" | "false"; GOOGLE_CLIENT_ID: string } => ({
  CHAT_ENABLED: "true",
  ENABLE_WEB_SEARCH: "true",
  GOOGLE_CLIENT_ID: "test-google-client-id"
});
const model = vi.fn();
const release = vi.fn();
const reserve = vi.fn(() => release);
const getConfig = vi.fn(config);
const verifyAuth = vi.fn(async () => ({ sub: "google-user-123", email: "reader@example.com", name: "Reader" }));
const recordAnalytics = vi.fn(async () => undefined);
const recordFeedback = vi.fn(async () => undefined);
const getProfile = vi.fn(async (): Promise<ProfileResponse | undefined> => ({ completed: false }));
const saveProfile = vi.fn(async () => true);
const recordTrack = vi.fn(async () => undefined);
const handlers = createHandlers({ runChat: model, reserveRequest: reserve, getConfig, verifyAuth, recordAnalytics, recordFeedback, getProfile, saveProfile, recordTrack });

function request(body: unknown, headers: Record<string, string> = {}) {
  return new HttpRequest({
    url: "http://localhost:7071/api/chat",
    method: "POST",
    headers: { origin: "http://localhost:3201", "content-type": "application/json", authorization: "Bearer valid-test-token", ...headers },
    body: { string: JSON.stringify(body) }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ALLOWED_ORIGINS", "http://localhost:3201");
  getConfig.mockImplementation(config);
  reserve.mockImplementation(() => release);
  verifyAuth.mockResolvedValue({ sub: "google-user-123", email: "reader@example.com", name: "Reader" });
  model.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("Functions request boundary", () => {
  it("requires a valid Google Bearer token on chat requests", async () => {
    const missing = await handlers.chat(new HttpRequest({
      url: "http://localhost:7071/api/chat",
      method: "POST",
      headers: { origin: "http://localhost:3201", "content-type": "application/json" },
      body: { string: JSON.stringify({ question: "hello" }) }
    }));
    expect(missing.status).toBe(401);
    expect(missing.headers).toMatchObject({ "Access-Control-Allow-Origin": "http://localhost:3201" });

    verifyAuth.mockRejectedValueOnce(new Error("expired"));
    const expired = await handlers.chat(request({ question: "hello" }));
    expect(expired.status).toBe(401);
    expect(model).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });

  it.each([{ question: "" }, { question: "a".repeat(2001) }, { question: "hello", includeWeb: "true" }, { question: "hello", endpoint: "https://untrusted.example" }])("rejects invalid input without calling upstream", async (body) => {
    expect((await handlers.chat(request(body))).status).toBe(400);
    expect(model).not.toHaveBeenCalled();
  });

  it("bounds actual body size and includes CORS on allowed-origin errors", async () => {
    const response = await handlers.chat(request({ question: "a".repeat(70000) }));
    expect(response.status).toBe(400);
    expect(response.headers).toMatchObject({ "Access-Control-Allow-Origin": "http://localhost:3201" });
    expect(model).not.toHaveBeenCalled();
  });

  it("allows configured preflight with authorization and blocks lookalike origins and unauthorized headers", async () => {
    const preflight = new HttpRequest({ url: "http://localhost:7071/api/chat", method: "OPTIONS", headers: { origin: "http://localhost:3201", "access-control-request-method": "POST", "access-control-request-headers": "content-type, authorization" } });
    expect((await handlers.chat(preflight)).status).toBe(204);
    expect((await handlers.chat(request({ question: "hello" }, { origin: "http://localhost:3201.evil.example" }))).status).toBe(403);
    preflight.headers.set("access-control-request-headers", "x-api-key");
    expect((await handlers.chat(preflight)).status).toBe(403);
    expect(model).not.toHaveBeenCalled();
  });

  it("fails closed without allowed origins and reports paused/unconfigured backends", async () => {
    vi.stubEnv("ALLOWED_ORIGINS", "");
    expect((await handlers.chat(request({ question: "hello" }))).status).toBe(503);
    vi.stubEnv("ALLOWED_ORIGINS", "http://localhost:3201");
    getConfig.mockImplementation(() => { throw new Error("unconfigured"); });
    expect((await handlers.chat(request({ question: "hello" }))).status).toBe(503);
    getConfig.mockReturnValue({ CHAT_ENABLED: "false", ENABLE_WEB_SEARCH: "true", GOOGLE_CLIENT_ID: "test-google-client-id" });
    expect((await handlers.chat(request({ question: "hello" }))).status).toBe(503);
    expect(model).not.toHaveBeenCalled();
  });

  it("scopes rate limits by verified Google user sub, not client headers", async () => {
    model.mockImplementation(async (_request, emit) => emit({ type: "done" }));
    const response = await handlers.chat(request({ question: "hello" }, { "x-arr-clientip": "attacker-controlled" }));
    await new HttpResponse(response).text();
    expect(verifyAuth).toHaveBeenCalledWith("valid-test-token", "test-google-client-id");
    expect(reserve).toHaveBeenCalledWith("google-user-123");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("streams before generation completes and aborts on stream cancellation", async () => {
    let activeSignal: AbortSignal | undefined;
    model.mockImplementation(async (_request, emit, signal) => {
      activeSignal = signal;
      emit({ type: "delta", section: "books", text: "first" });
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    });
    const response = await handlers.chat(request({ question: "hello" }));
    const body = new HttpResponse(response).body;
    if (!body) throw new Error("Expected a streaming body");
    const reader = body.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("first");
    expect(release).not.toHaveBeenCalled();
    await reader.cancel();
    expect(activeSignal?.aborted).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("reports generation failure and releases admission", async () => {
    model.mockRejectedValue(new Error("provider error"));
    const response = await handlers.chat(request({ question: "hello" }));
    expect(await new HttpResponse(response).text()).toContain('"type":"error"');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("bounds stalled work with a deadline and releases admission", async () => {
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    model.mockImplementation(async (_request, _emit, signal) => {
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    });
    const response = await handlers.chat(request({ question: "hello" }));
    expect(timeout).toHaveBeenCalledWith(190000);
    deadline.abort();
    expect(await new HttpResponse(response).text()).toBe("");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("rejects busy requests before running a provider", async () => {
    const busy = createHandlers({ runChat: model, reserveRequest: () => undefined, getConfig, verifyAuth, recordAnalytics, recordFeedback });
    expect((await busy.chat(request({ question: "hello" }))).status).toBe(429);
    expect(model).not.toHaveBeenCalled();
  });

  it("records analytics after chat completes", async () => {
    model.mockImplementation(async (_request, emit, _signal, onMetrics) => {
      onMetrics?.({ bookHits: 3, inputTokens: 150, outputTokens: 60 });
      emit({ type: "done" });
    });
    const chatResponse = await handlers.chat(request({ question: "headache" }));
    await new HttpResponse(chatResponse).text();
    expect(recordAnalytics).toHaveBeenCalledWith(expect.objectContaining({
      userSub: "google-user-123",
      userEmail: "reader@example.com",
      status: "complete",
      bookHits: 3,
      inputTokens: 150,
      outputTokens: 60
    }));
  });

  it("passes tracking ids and derived stream metrics to analytics", async () => {
    model.mockImplementation(async (_request, emit, _signal, onMetrics) => {
      emit({ type: "start", section: "web" });
      emit({ type: "delta", section: "web", text: "abcd" });
      emit({ type: "sources", section: "web", sources: [{ kind: "web", id: "W1", title: "A", url: "https://example.test/a" }, { kind: "web", id: "W2", title: "B", url: "https://example.test/b" }] });
      emit({ type: "error", section: "books", message: "failed" });
      onMetrics?.({ bookHits: 0 });
      emit({ type: "done" });
    });
    const ids = { messageId: "message-0001", sessionId: "session-0001", conversationId: "conv-00001" };
    await new HttpResponse(await handlers.chat(request({ question: "headache", includeWeb: true, ...ids }))).text();
    expect(recordAnalytics).toHaveBeenCalledWith(expect.objectContaining({
      ...ids, webHits: 2, answerChars: 4, errorSections: "books", noEvidence: false, status: "error"
    }));
    const [entry] = recordAnalytics.mock.calls[0] as unknown as [{ timeToFirstTokenMs?: number }];
    expect(entry.timeToFirstTokenMs).toBeGreaterThanOrEqual(0);
  });

  it("flags answers with no supporting book passages", async () => {
    model.mockImplementation(async (_request, emit) => { emit({ type: "delta", section: "books", text: "none found" }); emit({ type: "done" }); });
    await new HttpResponse(await handlers.chat(request({ question: "obscure" }))).text();
    expect(recordAnalytics).toHaveBeenCalledWith(expect.objectContaining({ noEvidence: true, bookHits: 0 }));
  });

  it("rejects malformed tracking ids on chat", async () => {
    expect((await handlers.chat(request({ question: "hello", sessionId: "bad id!" }))).status).toBe(400);
    expect(model).not.toHaveBeenCalled();
  });

  it("serves and saves the one-time profile for the verified user only", async () => {
    const url = "http://localhost:7071/api/profile";
    const headers = { origin: "http://localhost:3201", "content-type": "application/json", authorization: "Bearer valid-test-token" };
    expect((await handlers.profile(new HttpRequest({ url, method: "GET", headers: { origin: headers.origin } }))).status).toBe(401);

    const first = await handlers.profile(new HttpRequest({ url, method: "GET", headers }));
    expect(first.status).toBe(200);
    expect(first.jsonBody).toEqual({ completed: false });
    expect(getProfile).toHaveBeenCalledWith({ sub: "google-user-123", email: "reader@example.com" });

    const post = (body: unknown) => handlers.profile(new HttpRequest({ url, method: "POST", headers, body: { string: JSON.stringify(body) } }));
    expect((await post({ role: "astronaut", ageBand: "18_24" })).status).toBe(400);
    expect((await post({ role: "doctor", ageBand: "18_24", userId: "someone-else" })).status).toBe(400);
    expect(saveProfile).not.toHaveBeenCalled();
    const saved = await post({ role: "doctor", ageBand: "35_44" });
    expect(saved.status).toBe(200);
    expect(saved.jsonBody).toEqual({ completed: true, role: "doctor", ageBand: "35_44" });
    expect(saveProfile).toHaveBeenCalledWith({ sub: "google-user-123", email: "reader@example.com" }, { role: "doctor", ageBand: "35_44" });

    saveProfile.mockResolvedValueOnce(false);
    expect((await post({ role: "doctor", ageBand: "35_44" })).status).toBe(503);
    getProfile.mockResolvedValueOnce(undefined);
    expect((await handlers.profile(new HttpRequest({ url, method: "GET", headers }))).status).toBe(503);
  });

  it("allows GET and POST preflight on profile only", async () => {
    const preflight = (method: string) => new HttpRequest({ url: "http://localhost:7071/api/profile", method: "OPTIONS", headers: { origin: "http://localhost:3201", "access-control-request-method": method, "access-control-request-headers": "authorization" } });
    for (const method of ["GET", "POST"]) expect((await handlers.profile(preflight(method))).status).toBe(204);
    expect((await handlers.profile(preflight("DELETE"))).status).toBe(403);
    expect((await handlers.track(preflight("GET"))).status).toBe(403);
    const put = new HttpRequest({ url: "http://localhost:7071/api/profile", method: "PUT", headers: { origin: "http://localhost:3201" } });
    expect((await handlers.profile(put)).status).toBe(405);
  });

  it("validates and records session and UI tracking events", async () => {
    const send = (body: unknown, authorization = "Bearer valid-test-token") => handlers.track(new HttpRequest({
      url: "http://localhost:7071/api/track", method: "POST",
      headers: { origin: "http://localhost:3201", "content-type": "application/json", authorization },
      body: { string: JSON.stringify(body) }
    }));
    expect((await send({ type: "session_heartbeat", sessionId: "session-0001", activeSeconds: 30 }, "")).status).toBe(401);
    expect((await send({ type: "session_heartbeat", sessionId: "session-0001", activeSeconds: -1 })).status).toBe(400);
    expect((await send({ type: "ui", sessionId: "session-0001", name: "drop_table" })).status).toBe(400);
    expect((await send({ type: "session_start", sessionId: "session-0001", device: "fridge" })).status).toBe(400);
    expect(recordTrack).not.toHaveBeenCalled();
    const ok = await send({ type: "session_start", sessionId: "session-0001", device: "mobile", locale: "en-IN" });
    expect(ok.status).toBe(204);
    expect(recordTrack).toHaveBeenCalledWith({ sub: "google-user-123", email: "reader@example.com" }, { type: "session_start", sessionId: "session-0001", device: "mobile", locale: "en-IN" });
    expect((await send({ type: "ui", sessionId: "session-0001", name: "suggestion_clicked", detail: "Understand a symptom" })).status).toBe(204);
  });

  it("requires auth and validates payloads on POST /api/feedback", async () => {
    const unauth = await handlers.feedback(new HttpRequest({
      url: "http://localhost:7071/api/feedback",
      method: "POST",
      headers: { origin: "http://localhost:3201", "content-type": "application/json" },
      body: { string: JSON.stringify({ messageId: "msg-1", feedback: "helpful" }) }
    }));
    expect(unauth.status).toBe(401);

    const bad = await handlers.feedback(new HttpRequest({
      url: "http://localhost:7071/api/feedback",
      method: "POST",
      headers: { origin: "http://localhost:3201", "content-type": "application/json", authorization: "Bearer valid-test-token" },
      body: { string: JSON.stringify({ messageId: "msg-1", feedback: "awesome" }) }
    }));
    expect(bad.status).toBe(400);

    const ok = await handlers.feedback(new HttpRequest({
      url: "http://localhost:7071/api/feedback",
      method: "POST",
      headers: { origin: "http://localhost:3201", "content-type": "application/json", authorization: "Bearer valid-test-token" },
      body: { string: JSON.stringify({ messageId: "msg-1", feedback: "not_helpful", includeWeb: true }) }
    }));
    expect(ok.status).toBe(200);
    expect(recordFeedback).toHaveBeenCalledWith({
      userSub: "google-user-123",
      userEmail: "reader@example.com",
      messageId: "msg-1",
      feedback: "not_helpful",
      includeWeb: true
    });
  });
});

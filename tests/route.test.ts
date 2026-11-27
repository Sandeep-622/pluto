import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpRequest, HttpResponse } from "@azure/functions";
import { createHandlers } from "@api/http";

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
const handlers = createHandlers({ runChat: model, reserveRequest: reserve, getConfig, verifyAuth });

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
    const busy = createHandlers({ runChat: model, reserveRequest: () => undefined, getConfig, verifyAuth });
    expect((await busy.chat(request({ question: "hello" }))).status).toBe(429);
    expect(model).not.toHaveBeenCalled();
  });
});

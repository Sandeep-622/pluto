import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runChat: vi.fn() }));
vi.mock("@/lib/server/chat", () => ({ runChat: mocks.runChat }));
vi.mock("@/lib/server/config", () => ({ getConfig: () => ({ CHAT_ENABLED: "true" }) }));
vi.mock("@/lib/server/limits", () => ({ reserveRequest: () => () => {} }));
import { POST } from "@/app/api/chat/route";

function request(body: unknown) { return new Request("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
beforeEach(() => vi.clearAllMocks());
describe("chat route input", () => {
  it.each([{ question: "" }, { question: "a".repeat(2001) }, { question: "hello", includeWeb: "true" }, { question: "hello", endpoint: "https://untrusted.example" }])("rejects invalid input without calling upstream", async (body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(mocks.runChat).not.toHaveBeenCalled();
  });
  it("bounds actual body size even without a content-length header", async () => {
    const response = await POST(request({ question: "a".repeat(70000) }));
    expect(response.status).toBe(400);
    expect(mocks.runChat).not.toHaveBeenCalled();
  });
  it("blocks cross-origin browser calls", async () => {
    const response = await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { origin: "https://untrusted.example", "content-type": "application/json" }, body: '{"question":"hello"}' }));
    expect(response.status).toBe(403);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatEvent, ChatRequest } from "@/lib/contract";

const mocks = vi.hoisted(() => ({ retrieve: vi.fn(), model: vi.fn() }));
vi.mock("@api/server/search", () => ({ retrieveBooks: mocks.retrieve }));
vi.mock("@api/server/openai", () => ({ streamModel: mocks.model }));
vi.mock("@api/server/config", () => ({ getConfig: () => ({ ENABLE_WEB_SEARCH: "true" }) }));
import { runChat } from "@api/server/chat";

const request: ChatRequest = { question: "What causes headache?", includeWeb: false, history: [] };
const evidence = [{ id: "B1", title: "Verified book", text: "Readable source" }];
beforeEach(() => { vi.clearAllMocks(); mocks.retrieve.mockResolvedValue(evidence); mocks.model.mockResolvedValue(undefined); });

describe("book and web orchestration", () => {
  it("does not invoke the web branch when off", async () => {
    const events: ChatEvent[] = [];
    await runChat(request, (event) => events.push(event), new AbortController().signal);
    expect(mocks.model).toHaveBeenCalledTimes(1);
    expect(mocks.model.mock.calls[0][2]).toBe(false);
    expect(events.some((event) => "section" in event && event.section === "web")).toBe(false);
  });
  it("emits web first and never passes book evidence into that branch", async () => {
    const events: ChatEvent[] = [];
    await runChat({ ...request, includeWeb: true }, (event) => events.push(event), new AbortController().signal);
    expect(mocks.model.mock.calls[0][1]).toEqual([]);
    expect(mocks.model.mock.calls[0][2]).toBe(true);
    expect(mocks.model.mock.calls[1][1]).toEqual(evidence);
    expect(events.filter((event) => event.type === "start")).toEqual([{ type: "start", section: "web" }, { type: "start", section: "books" }]);
  });
  it("reports web failure but still completes the independent book section", async () => {
    mocks.model.mockRejectedValueOnce(new Error("Upstream failure"));
    const events: ChatEvent[] = [];
    await runChat({ ...request, includeWeb: true }, (event) => events.push(event), new AbortController().signal);
    expect(events.some((event) => event.type === "error" && event.section === "web")).toBe(true);
    expect(events).toContainEqual({ type: "section-done", section: "books" });
    expect(events.at(-1)).toEqual({ type: "done" });
  });
  it("does not call the book model with empty evidence", async () => {
    mocks.retrieve.mockResolvedValue([]);
    const events: ChatEvent[] = [];
    await runChat(request, (event) => events.push(event), new AbortController().signal);
    expect(mocks.model).not.toHaveBeenCalled();
    expect(events).toContainEqual(expect.objectContaining({ type: "delta", section: "books", text: expect.stringContaining("couldn't find readable") }));
  });
});

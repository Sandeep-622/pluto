import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@api/server/config", () => ({ getConfig: () => ({ AZURE_OPENAI_CHAT_DEPLOYMENT: "test-luna" }) }));
import { modelRequest } from "@api/server/openai";

beforeEach(() => { vi.clearAllMocks(); });
describe("model request boundaries", () => {
  it("omits tools in book mode and does not inject old assistant web claims", () => {
    const result = modelRequest({ question: "Headache?", includeWeb: false, history: [{ role: "assistant", content: "An unsupported prior web claim", includeWeb: true }] }, [{ id: "B1", title: "Book", text: "Book evidence" }], false);
    expect(result.tools).toBeUndefined();
    expect(result.input).not.toContain("unsupported prior web");
    expect(result.input).toContain("Book evidence");
    expect(result.store).toBe(false);
  });
  it("attaches the required real web tool but never includes book text in its input", () => {
    const result = modelRequest({ question: "Headache?", includeWeb: true, history: [] }, [{ id: "B1", title: "Private book", text: "Private excerpt" }], true);
    expect(result.tools).toEqual([{ type: "web_search" }]);
    expect(result.tool_choice).toBe("required");
    expect(result.max_tool_calls).toBe(1);
    expect(result.input).not.toContain("Private excerpt");
  });
});

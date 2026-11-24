import { describe, expect, it } from "vitest";
import { readChatStream } from "@/lib/stream";
import { requestHistory, restoreHistory, type Message } from "@/lib/history";
import type { ChatEvent } from "@/lib/contract";

describe("chat transport and history", () => {
  it("decodes events across network and Unicode byte boundaries", async () => {
    const text = `${JSON.stringify({ type: "delta", section: "books", text: "β headache" })}\n${JSON.stringify({ type: "done" })}\n`;
    const bytes = new TextEncoder().encode(text);
    const body = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
    const events: ChatEvent[] = [];
    await readChatStream(new Response(body), (event) => events.push(event));
    expect(events).toEqual([{ type: "delta", section: "books", text: "β headache" }, { type: "done" }]);
  });
  it("does not report a truncated stream as completed", async () => {
    await expect(readChatStream(new Response('{"type":"start","section":"books"}\n'), () => {})).rejects.toThrow("before the answer finished");
  });
  it("restores unfinished answers as stopped", () => {
    const messages = [{ id: "answer", role: "assistant", text: "", includeWeb: true, status: "loading", sections: [{ kind: "web", text: "Partial", sources: [], status: "loading" }] }];
    const saved = JSON.stringify({ version: 1, conversations: [{ id: "chat", title: "Question", updatedAt: 1, messages }] });
    const answer = restoreHistory(saved)[0].messages[0];
    expect(answer.status).toBe("stopped");
    expect(answer.sections[0].status).toBe("stopped");
    expect(answer.includeWeb).toBe(true);
  });
  it("never forwards earlier generated book or web text as evidence", () => {
    const messages: Message[] = [
      { id: "1", role: "user", text: "What is headache?", includeWeb: true, status: "complete", sections: [] },
      { id: "2", role: "assistant", text: "Secret old web claim", includeWeb: true, status: "complete", sections: [] }
    ];
    expect(requestHistory(messages)).toEqual([{ role: "user", content: "What is headache?", includeWeb: true }]);
  });
});

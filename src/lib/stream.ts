import { streamEventSchema, type ChatEvent } from "./contract";

export async function readChatStream(response: Response, onEvent: (event: ChatEvent) => void) {
  if (!response.ok) {
    const data: unknown = await response.json();
    const message = typeof data === "object" && data && "error" in data && typeof data.error === "string" ? data.error : "The server could not accept this question.";
    throw new Error(message);
  }
  if (!response.body) throw new Error("The server returned no answer stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let complete = false;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = streamEventSchema.parse(JSON.parse(line));
    if (event.type === "done") complete = true;
    onEvent(event);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = pending.indexOf("\n")) !== -1) {
        consume(pending.slice(0, end));
        pending = pending.slice(end + 1);
      }
      if (pending.length > 200000) throw new Error("The server sent an invalid answer stream.");
    }
    pending += decoder.decode();
    if (pending.trim()) consume(pending);
    if (!complete) throw new Error("The connection stopped before the answer finished.");
  } finally {
    reader.releaseLock();
  }
}

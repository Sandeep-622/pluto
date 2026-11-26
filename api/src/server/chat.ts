import type { ChatEvent, ChatRequest } from "../../../src/lib/contract";
import { getConfig } from "./config";
import { retrieveBooks } from "./search";
import { streamModel } from "./openai";

export type ChatMetrics = {
  bookHits: number;
  inputTokens: number;
  outputTokens: number;
};

export async function runChat(
  request: ChatRequest,
  emit: (event: ChatEvent) => void,
  signal: AbortSignal,
  onMetrics?: (metrics: Partial<ChatMetrics>) => void
) {
  const config = getConfig();
  let inputTokens = 0;
  let outputTokens = 0;
  const addUsage = (usage: { inputTokens: number; outputTokens: number }) => {
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
    onMetrics?.({ inputTokens, outputTokens });
  };
  const retrieval = retrieveBooks(request, signal).then(
    (evidence) => {
      onMetrics?.({ bookHits: evidence.length });
      return { ok: true as const, evidence };
    },
    (error: unknown) => ({ ok: false as const, error })
  );
  if (request.includeWeb) {
    emit({ type: "start", section: "web" });
    try {
      if (config.ENABLE_WEB_SEARCH !== "true") throw new Error("Web search is disabled by the demo administrator.");
      await streamModel(request, [], true, emit, AbortSignal.any([signal, AbortSignal.timeout(90000)]), addUsage);
      emit({ type: "section-done", section: "web" });
    } catch (error) {
      if (signal.aborted) throw error;
      console.error("Web section failed", { type: error instanceof Error ? error.name : "unknown" });
      emit({ type: "error", section: "web", message: "Web research is unavailable or could not return verified citations. Any partial web text is unverified. You can still read the book section below." });
    }
  }
  signal.throwIfAborted();
  emit({ type: "start", section: "books" });
  try {
    const result = await retrieval;
    if (!result.ok) throw result.error;
    if (result.evidence.length === 0) {
      emit({ type: "delta", section: "books", text: "I couldn't find readable supporting passages in the indexed books. Try a more specific book-related question. No answer has been filled in from general model knowledge." });
    } else {
      await streamModel(request, result.evidence, false, emit, AbortSignal.any([signal, AbortSignal.timeout(90000)]), addUsage);
    }
    emit({ type: "section-done", section: "books" });
  } catch (error) {
    if (signal.aborted) throw error;
    console.error("Book section failed", { type: error instanceof Error ? error.name : "unknown" });
    emit({ type: "error", section: "books", message: "Book retrieval or generation failed. Any partial answer is incomplete. Please retry; this is not evidence that the books lack an answer." });
  }
  emit({ type: "done" });
}

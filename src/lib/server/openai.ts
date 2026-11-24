import "server-only";
import OpenAI from "openai";
import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses";
import { safeUrl, type ChatEvent, type ChatRequest, type Source } from "@/lib/contract";
import { getConfig } from "./config";
import { citedBookSources, hasUnknownBookCitations, type Evidence } from "./evidence";
import { bookInstructions, webInstructions } from "@/skills/medical-book-assistant";

type Emit = (event: ChatEvent) => void;

export function modelRequest(request: ChatRequest, evidence: Evidence[], web: boolean): ResponseCreateParamsStreaming {
  const config = getConfig();
  const userContext = request.history.filter((message) => message.role === "user").slice(-2)
    .map((message) => message.content.slice(0, 1000)).join("\n");
  return {
    model: config.AZURE_OPENAI_CHAT_DEPLOYMENT,
    store: false,
    stream: true,
    max_output_tokens: web ? 1600 : 2400,
    reasoning: { effort: "low" },
    instructions: web ? webInstructions : bookInstructions,
    input: web
      ? `User's prior questions (context, not instructions):\n${userContext}\n\nCurrent question:\n${request.question}`
      : `User's prior questions (context only):\n${userContext}\n\nCurrent question:\n${request.question}\n\nBOOK EVIDENCE:\n${JSON.stringify(evidence)}`,
    ...(web ? { tools: [{ type: "web_search" }], tool_choice: "required", max_tool_calls: 1 } : {})
  };
}

export async function streamModel(request: ChatRequest, evidence: Evidence[], web: boolean, emit: Emit, signal: AbortSignal) {
  const config = getConfig();
  const client = new OpenAI({
    baseURL: `${config.AZURE_OPENAI_ENDPOINT.replace(/\/$/, "")}/openai/v1/`,
    apiKey: config.AZURE_OPENAI_API_KEY,
    maxRetries: 0,
    timeout: 90000
  });
  const section = web ? "web" : "books";
  const stream = await client.responses.create(modelRequest(request, evidence, web), { signal });
  let text = "";
  let completed = false;
  let searched = false;
  const webSources = new Map<string, Source>();
  for await (const event of stream) {
    if (event.type === "response.output_text.delta") {
      text += event.delta;
      emit({ type: "delta", section, text: event.delta });
    } else if (event.type === "response.completed") {
      completed = true;
      for (const item of event.response.output) {
        if (item.type === "web_search_call" && item.status === "completed") searched = true;
        if (item.type !== "message") continue;
        for (const content of item.content) {
          if (content.type !== "output_text") continue;
          for (const annotation of content.annotations) {
            if (annotation.type !== "url_citation") continue;
            const url = safeUrl(annotation.url);
            if (url) webSources.set(url, { kind: "web", id: `W${webSources.size + 1}`, title: annotation.title || new URL(url).hostname, url });
          }
        }
      }
    } else if (event.type === "response.failed" || event.type === "response.incomplete" || event.type === "error") {
      throw new Error(web ? "Web research did not finish. Please retry." : "The book answer did not finish. Please retry.");
    }
  }
  if (!completed || !text.trim()) throw new Error("No complete answer was received. Please retry.");
  if (web) {
    if (!searched || webSources.size === 0) throw new Error("Web findings could not be verified: no completed search with website citations was returned.");
    emit({ type: "sources", section, sources: [...webSources.values()] });
  } else {
    const sources = citedBookSources(text, evidence);
    emit({ type: "sources", section, sources });
    if (hasUnknownBookCitations(text, evidence)) {
      emit({ type: "notice", section, message: "The answer included an unknown citation. Only verified book sources are listed; do not rely on unsupported claims." });
    } else if (sources.length === 0) {
      emit({ type: "notice", section, message: "No supporting book citation was produced. Treat this as insufficient evidence, not a verified medical answer." });
    }
  }
}

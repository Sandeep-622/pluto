import { z } from "zod";
import { getConfig } from "./config";
import { selectEvidence } from "./evidence";
import type { ChatRequest } from "../../../src/lib/contract";

const resultSchema = z.object({ value: z.array(z.object({
  chunk_id: z.string(), parent_id: z.string().optional(), title: z.string(), chunk: z.string()
})) });

export async function retrieveBooks(request: ChatRequest, signal: AbortSignal) {
  const config = getConfig();
  const previous = request.history.filter((message) => message.role === "user").slice(-1);
  const query = [...previous.map((message) => message.content.slice(0, 1000)), request.question].join("\n");
  const url = `${config.AZURE_SEARCH_ENDPOINT.replace(/\/$/, "")}/indexes/${encodeURIComponent(config.AZURE_SEARCH_INDEX)}/docs/search?api-version=${encodeURIComponent(config.AZURE_SEARCH_API_VERSION)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "api-key": config.AZURE_SEARCH_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      search: query,
      searchFields: "chunk",
      vectorQueries: [{ kind: "text", text: query, fields: "text_vector", k: 30 }],
      select: "chunk_id,parent_id,title,chunk",
      top: 15
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]),
    cache: "no-store"
  });
  if (!response.ok) {
    console.error("Search request failed", { status: response.status });
    throw new Error(response.status === 429
      ? "Book search is busy. Please try again shortly."
      : "Book search is unavailable. Please try again or contact the demo administrator.");
  }
  return selectEvidence(resultSchema.parse(await response.json()).value);
}

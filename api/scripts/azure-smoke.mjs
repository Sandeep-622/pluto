import OpenAI from "openai";

const required = ["AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_API_KEY", "AZURE_SEARCH_ENDPOINT", "AZURE_SEARCH_API_KEY", "AZURE_SEARCH_INDEX"];
if (required.some((name) => !process.env[name])) throw new Error("Missing required environment settings.");
const url = `${process.env.AZURE_SEARCH_ENDPOINT}/indexes/${process.env.AZURE_SEARCH_INDEX}/docs/search?api-version=${process.env.AZURE_SEARCH_API_VERSION}`;
const response = await fetch(url, {
  method: "POST",
  headers: { "api-key": process.env.AZURE_SEARCH_API_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ search: "headache", count: true, select: "chunk_id,title,chunk", top: 5, vectorQueries: [{ kind: "text", text: "What do the books explain about headache?", fields: "text_vector", k: 15 }] }),
  signal: AbortSignal.timeout(60000)
});
if (!response.ok) throw new Error(`Hybrid retrieval failed with HTTP ${response.status}.`);
const data = await response.json();
const readable = data.value.filter((chunk) => {
  const characters = [...chunk.chunk].filter((character) => !/\s/u.test(character));
  return characters.length >= 60 && characters.filter((character) => /[\p{Co}\uFFFD]/u.test(character)).length / characters.length < 0.05;
});
console.log(JSON.stringify({ test: "hybrid-retrieval", results: data.value.length, readable: readable.length, titles: [...new Set(readable.map((chunk) => chunk.title))] }));
if (!readable.length) throw new Error("No readable passages were returned. Check document permissions and extraction.");
if (process.argv.includes("--web")) {
  const client = new OpenAI({ baseURL: `${process.env.AZURE_OPENAI_ENDPOINT.replace(/\/$/, "")}/openai/v1/`, apiKey: process.env.AZURE_OPENAI_API_KEY, maxRetries: 0 });
  try {
    const result = await client.responses.create({ model: process.env.AZURE_OPENAI_CHAT_DEPLOYMENT, store: false, tools: [{ type: "web_search" }], tool_choice: "required", max_tool_calls: 1, reasoning: { effort: "low" }, max_output_tokens: 1600, input: "Search for an official NHS page explaining headache and summarize it in three short sentences with its website citation." });
    const searched = result.output.some((item) => item.type === "web_search_call" && item.status === "completed");
    const citations = result.output.filter((item) => item.type === "message").flatMap((item) => item.content).filter((part) => part.type === "output_text").flatMap((part) => part.annotations).filter((annotation) => annotation.type === "url_citation");
    console.log(JSON.stringify({ test: "web-search", status: result.status, searched, citationCount: citations.length, domains: [...new Set(citations.map((citation) => new URL(citation.url).hostname))], outputCharacters: result.output_text.length }));
    if (!searched || !citations.length || !result.output_text) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ test: "web-search", errorType: error.name, status: error.status, code: error.code }));
    process.exitCode = 1;
  }
}

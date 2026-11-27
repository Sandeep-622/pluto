import { z } from "zod";

const configSchema = z.object({
  AZURE_OPENAI_ENDPOINT: z.string().url().refine((value) => new URL(value).protocol === "https:"),
  AZURE_OPENAI_API_KEY: z.string().min(10),
  AZURE_OPENAI_CHAT_DEPLOYMENT: z.string().min(1),
  AZURE_SEARCH_ENDPOINT: z.string().url().refine((value) => new URL(value).protocol === "https:"),
  AZURE_SEARCH_API_KEY: z.string().min(10),
  AZURE_SEARCH_INDEX: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  AZURE_SEARCH_API_VERSION: z.string().default("2026-08-01-preview"),
  ENABLE_WEB_SEARCH: z.enum(["true", "false"]).default("false"),
  CHAT_ENABLED: z.enum(["true", "false"]).default("true"),
  GOOGLE_CLIENT_ID: z.string().min(10)
});

export function getConfig() {
  const parsed = configSchema.safeParse(process.env);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path[0]))];
    console.error("Invalid server configuration fields:", fields.join(", "));
    throw new Error("The server is not configured. Contact the demo administrator.");
  }
  return parsed.data;
}

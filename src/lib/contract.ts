import { z } from "zod";

export const sectionSchema = z.enum(["web", "books"]);
export type SectionKind = z.infer<typeof sectionSchema>;
export const sourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("books"), id: z.string(), title: z.string() }),
  z.object({ kind: z.literal("web"), id: z.string(), title: z.string(), url: z.string().url() })
]);
export type Source = z.infer<typeof sourceSchema>;

export const sectionStateSchema = z.object({
  kind: sectionSchema,
  text: z.string(),
  sources: z.array(sourceSchema).max(50),
  status: z.enum(["loading", "complete", "error", "stopped"]),
  notice: z.string().optional()
});
export type AnswerSection = z.infer<typeof sectionStateSchema>;

export const chatRequestSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  includeWeb: z.boolean().default(false),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(8000),
    includeWeb: z.boolean().default(false)
  }).strict()).max(6).default([])
}).strict();
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const streamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start"), section: sectionSchema }),
  z.object({ type: z.literal("delta"), section: sectionSchema, text: z.string() }),
  z.object({ type: z.literal("sources"), section: sectionSchema, sources: z.array(sourceSchema) }),
  z.object({ type: z.literal("notice"), section: sectionSchema, message: z.string() }),
  z.object({ type: z.literal("section-done"), section: sectionSchema }),
  z.object({ type: z.literal("error"), section: sectionSchema, message: z.string() }),
  z.object({ type: z.literal("done") })
]);
export type ChatEvent = z.infer<typeof streamEventSchema>;

export function safeUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

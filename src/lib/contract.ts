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

// Opaque client-generated identifiers used only to join analytics rows.
export const trackingIdSchema = z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/);

export const chatRequestSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  includeWeb: z.boolean().default(false),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(8000),
    includeWeb: z.boolean().default(false)
  }).strict()).max(6).default([]),
  messageId: trackingIdSchema.optional(),
  sessionId: trackingIdSchema.optional(),
  conversationId: trackingIdSchema.optional()
}).strict();
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const feedbackValueSchema = z.enum(["helpful", "not_helpful"]);
export type FeedbackValue = z.infer<typeof feedbackValueSchema>;

export const feedbackReasonSchema = z.enum(["inaccurate", "not_relevant", "incomplete", "bad_sources", "other"]);
export type FeedbackReason = z.infer<typeof feedbackReasonSchema>;
export const feedbackReasonOptions: { value: FeedbackReason; label: string }[] = [
  { value: "inaccurate", label: "Inaccurate" },
  { value: "not_relevant", label: "Not relevant" },
  { value: "incomplete", label: "Incomplete" },
  { value: "bad_sources", label: "Poor sources" },
  { value: "other", label: "Other" }
];

export const feedbackRequestSchema = z.object({
  messageId: z.string().min(1).max(100),
  feedback: feedbackValueSchema,
  includeWeb: z.boolean().default(false),
  reason: feedbackReasonSchema.optional(),
  sessionId: trackingIdSchema.optional(),
  conversationId: trackingIdSchema.optional()
}).strict();
export type FeedbackRequest = z.infer<typeof feedbackRequestSchema>;

export const roleSchema = z.enum(["doctor", "resident", "mbbs_student", "phd_researcher", "nursing_allied", "pharmacy", "other"]);
export type Role = z.infer<typeof roleSchema>;
export const roleOptions: { value: Role; label: string; hint: string }[] = [
  { value: "doctor", label: "Doctor", hint: "Practising physician or specialist" },
  { value: "resident", label: "Resident", hint: "Postgraduate trainee (MD / MS / DNB)" },
  { value: "mbbs_student", label: "MBBS student", hint: "Undergraduate medical student" },
  { value: "phd_researcher", label: "PhD / researcher", hint: "Doctoral or research work" },
  { value: "nursing_allied", label: "Nursing / allied health", hint: "Nurse, physio, technician and others" },
  { value: "pharmacy", label: "Pharmacy", hint: "Pharmacist or pharmacy student" },
  { value: "other", label: "Something else", hint: "Anything not listed here" }
];

export const ageBandSchema = z.enum(["under_18", "18_24", "25_34", "35_44", "45_54", "55_plus", "prefer_not_to_say"]);
export type AgeBand = z.infer<typeof ageBandSchema>;
export const ageBandOptions: { value: AgeBand; label: string }[] = [
  { value: "under_18", label: "Under 18" },
  { value: "18_24", label: "18 – 24" },
  { value: "25_34", label: "25 – 34" },
  { value: "35_44", label: "35 – 44" },
  { value: "45_54", label: "45 – 54" },
  { value: "55_plus", label: "55 and over" },
  { value: "prefer_not_to_say", label: "Prefer not to say" }
];

export const profileRequestSchema = z.object({ role: roleSchema, ageBand: ageBandSchema }).strict();
export type ProfileRequest = z.infer<typeof profileRequestSchema>;
export type ProfileResponse = { completed: boolean; role?: Role; ageBand?: AgeBand };

export const deviceSchema = z.enum(["mobile", "tablet", "desktop"]);
export const uiEventNameSchema = z.enum([
  "suggestion_clicked", "web_toggled", "new_chat", "conversation_opened", "conversation_deleted",
  "history_cleared", "citation_clicked", "query_stopped", "feedback_reason_shown", "sign_out"
]);
export type UiEventName = z.infer<typeof uiEventNameSchema>;

export const trackRequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session_start"),
    sessionId: trackingIdSchema,
    device: deviceSchema,
    locale: z.string().max(20).optional(),
    timeZone: z.string().max(64).optional()
  }).strict(),
  z.object({ type: z.literal("session_heartbeat"), sessionId: trackingIdSchema, activeSeconds: z.number().int().min(0).max(86400) }).strict(),
  z.object({ type: z.literal("session_end"), sessionId: trackingIdSchema, activeSeconds: z.number().int().min(0).max(86400) }).strict(),
  z.object({
    type: z.literal("ui"),
    sessionId: trackingIdSchema,
    name: uiEventNameSchema,
    detail: z.string().max(60).optional(),
    includeWeb: z.boolean().optional()
  }).strict()
]);
export type TrackRequest = z.infer<typeof trackRequestSchema>;

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

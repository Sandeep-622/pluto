import { z } from "zod";
import { feedbackReasonSchema, feedbackValueSchema, sectionStateSchema } from "./contract";

export const messageSchema = z.object({
  id: z.string(), role: z.enum(["user", "assistant"]), text: z.string().max(100000),
  includeWeb: z.boolean(), sections: z.array(sectionStateSchema).max(2),
  status: z.enum(["loading", "complete", "error", "stopped"]),
  feedback: feedbackValueSchema.optional(),
  feedbackReason: feedbackReasonSchema.optional()
});
export type Message = z.infer<typeof messageSchema>;
const conversationSchema = z.object({
  id: z.string(), title: z.string().max(100), updatedAt: z.number(), messages: z.array(messageSchema).max(100)
});
export type Conversation = z.infer<typeof conversationSchema>;
export const historySchema = z.object({ version: z.literal(1), conversations: z.array(conversationSchema).max(30) });
export const historyKey = "pluto-chats-v1";

export function restoreHistory(value: string): Conversation[] {
  const data = historySchema.parse(JSON.parse(value));
  return data.conversations.map((conversation) => ({
    ...conversation,
    messages: conversation.messages.map((message) => ({
      ...message,
      status: message.status === "loading" ? "stopped" : message.status,
      sections: message.sections.map((section) => ({ ...section, status: section.status === "loading" ? "stopped" : section.status }))
    }))
  }));
}

export function requestHistory(messages: Message[]) {
  // Only prior user questions provide context; old web/model answers are not evidence.
  return messages.filter((message) => message.role === "user").slice(-3)
    .map((message) => ({ role: "user" as const, content: message.text.slice(0, 2000), includeWeb: message.includeWeb }));
}

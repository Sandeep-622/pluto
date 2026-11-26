import { afterEach, describe, expect, it, vi } from "vitest";
import { recordChatAnalytics, recordFeedback } from "@api/server/analytics";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Table Storage analytics and feedback writers", () => {
  it("skips writes cleanly when no storage connection string is configured", async () => {
    vi.stubEnv("ANALYTICS_STORAGE_CONNECTION_STRING", "");
    vi.stubEnv("AzureWebJobsStorage", "");
    await expect(recordChatAnalytics({
      userSub: "sub-1",
      userEmail: "reader@example.com",
      includeWeb: false,
      questionLength: 10,
      historyCount: 0,
      status: "complete",
      durationMs: 120,
      bookHits: 2,
      inputTokens: 80,
      outputTokens: 30
    })).resolves.toBeUndefined();
    await expect(recordFeedback({
      userSub: "sub-1",
      userEmail: "reader@example.com",
      messageId: "msg-1",
      feedback: "helpful",
      includeWeb: false
    })).resolves.toBeUndefined();
  });
});

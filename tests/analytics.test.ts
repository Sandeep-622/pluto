import { describe, expect, it } from "vitest";
import { analyticsToCsv, summarizeAnalytics, type AnalyticsRow } from "@api/server/analytics";

describe("analytics aggregation and CSV export", () => {
  const rows: AnalyticsRow[] = [
    {
      partitionKey: "2026-11-25",
      rowKey: "2",
      userSub: "u1",
      userEmail: "alice@example.com",
      includeWeb: true,
      questionLength: 24,
      historyCount: 1,
      status: "complete",
      durationMs: 400,
      bookHits: 3,
      inputTokens: 200,
      outputTokens: 80,
      createdAt: "2026-11-25T10:00:00.000Z"
    },
    {
      partitionKey: "2026-11-25",
      rowKey: "1",
      userSub: "u2",
      userEmail: "=cmd@example.com",
      includeWeb: false,
      questionLength: 12,
      historyCount: 0,
      status: "error",
      durationMs: 200,
      bookHits: 0,
      inputTokens: 0,
      outputTokens: 0,
      createdAt: "2026-11-25T09:00:00.000Z"
    }
  ];

  it("summarizes counts, unique users, tokens, and daily breakdowns", () => {
    const report = summarizeAnalytics(rows, 7, [
      {
        partitionKey: "u1",
        rowKey: "msg-1",
        userSub: "u1",
        userEmail: "alice@example.com",
        messageId: "msg-1",
        feedback: "helpful",
        includeWeb: true,
        date: "2026-11-25",
        updatedAt: "2026-11-25T10:05:00.000Z"
      },
      {
        partitionKey: "u2",
        rowKey: "msg-2",
        userSub: "u2",
        userEmail: "bob@example.com",
        messageId: "msg-2",
        feedback: "not_helpful",
        includeWeb: false,
        date: "2026-11-25",
        updatedAt: "2026-11-25T09:05:00.000Z"
      }
    ]);
    expect(report.summary).toEqual({
      totalQueries: 2,
      uniqueUsers: 2,
      webQueries: 1,
      completeCount: 1,
      errorCount: 1,
      abortedCount: 0,
      totalInputTokens: 200,
      totalOutputTokens: 80,
      avgDurationMs: 300,
      helpfulCount: 1,
      notHelpfulCount: 1
    });
    expect(report.byDay).toEqual([{ date: "2026-11-25", queries: 2, uniqueUsers: 2, webQueries: 1, errors: 1 }]);
    expect(report.byUser).toHaveLength(2);
    expect(report.recentFeedback).toHaveLength(2);
  });

  it("escapes CSV cells and prevents spreadsheet formula injection", () => {
    const csv = analyticsToCsv(rows);
    expect(csv).toContain("alice@example.com");
    expect(csv).toContain("'=cmd@example.com");
  });
});

import { TableClient, TableServiceClient } from "@azure/data-tables";
import { randomUUID } from "node:crypto";
import type { FeedbackValue } from "../../../src/lib/contract";

export type ChatOutcome = "complete" | "aborted" | "error";

export type AnalyticsInput = {
  userSub: string;
  userEmail: string;
  includeWeb: boolean;
  questionLength: number;
  historyCount: number;
  status: ChatOutcome;
  durationMs: number;
  bookHits: number;
  inputTokens: number;
  outputTokens: number;
};

export type AnalyticsRow = AnalyticsInput & {
  partitionKey: string;
  rowKey: string;
  createdAt: string;
};

export type FeedbackInput = {
  userSub: string;
  userEmail: string;
  messageId: string;
  feedback: FeedbackValue;
  includeWeb: boolean;
};

export type FeedbackRow = FeedbackInput & {
  partitionKey: string;
  rowKey: string;
  date: string;
  updatedAt: string;
};

const tableName = "plutoanalytics";
const feedbackTableName = "plutofeedback";
const tableReady = new Map<string, Promise<void>>();

function storageConnectionString(): string | undefined {
  return process.env.ANALYTICS_STORAGE_CONNECTION_STRING?.trim() || process.env.AzureWebJobsStorage?.trim() || undefined;
}

function getClient(connectionString: string, name = tableName): TableClient {
  const allowInsecureConnection = connectionString.includes("http://") || connectionString.includes("DefaultEndpointsProtocol=http");
  return TableClient.fromConnectionString(connectionString, name, { allowInsecureConnection });
}

async function ensureTable(connectionString: string, name = tableName): Promise<void> {
  const cacheKey = `${connectionString}::${name}`;
  let pending = tableReady.get(cacheKey);
  if (!pending) {
    const allowInsecureConnection = connectionString.includes("http://") || connectionString.includes("DefaultEndpointsProtocol=http");
    const service = TableServiceClient.fromConnectionString(connectionString, { allowInsecureConnection });
    pending = service.createTable(name).catch((error: unknown) => {
      const code = typeof error === "object" && error && "statusCode" in error ? error.statusCode : undefined;
      if (code !== 409) throw error;
    });
    tableReady.set(cacheKey, pending);
  }
  try {
    await pending;
  } catch (error) {
    tableReady.delete(cacheKey);
    throw error;
  }
}

function safeKey(value: string): string {
  return value.replace(/[\\/#?\u0000-\u001f\u007f-\u009f]/g, "_");
}

export async function recordFeedback(entry: FeedbackInput): Promise<void> {
  const connectionString = storageConnectionString();
  if (!connectionString) return;
  try {
    await ensureTable(connectionString, feedbackTableName);
    const updatedAt = new Date().toISOString();
    const entity: FeedbackRow = {
      partitionKey: safeKey(entry.userSub),
      rowKey: safeKey(entry.messageId),
      ...entry,
      date: updatedAt.slice(0, 10),
      updatedAt
    };
    await getClient(connectionString, feedbackTableName).upsertEntity(entity, "Replace");
  } catch (error) {
    console.warn("Feedback write skipped", { type: error instanceof Error ? error.name : "unknown" });
  }
}

export async function recordChatAnalytics(entry: AnalyticsInput): Promise<void> {
  const connectionString = storageConnectionString();
  if (!connectionString) return;
  try {
    await ensureTable(connectionString);
    const now = Date.now();
    const createdAt = new Date(now).toISOString();
    const entity: AnalyticsRow = {
      partitionKey: createdAt.slice(0, 10),
      rowKey: `${String(now).padStart(13, "0")}-${randomUUID()}`,
      ...entry,
      createdAt
    };
    await getClient(connectionString).createEntity(entity);
  } catch (error) {
    console.warn("Analytics write skipped", { type: error instanceof Error ? error.name : "unknown" });
  }
}

function recentDates(days: number): string[] {
  const result: string[] = [];
  const today = new Date();
  for (let offset = 0; offset < days; offset++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - offset));
    result.push(d.toISOString().slice(0, 10));
  }
  return result;
}

export async function queryChatAnalyticsRows(days = 7): Promise<{ days: number; rows: AnalyticsRow[]; feedbackRows: FeedbackRow[] }> {
  const boundedDays = Math.min(90, Math.max(1, Math.floor(days)));
  const connectionString = storageConnectionString();
  const rows: AnalyticsRow[] = [];
  const feedbackRows: FeedbackRow[] = [];
  if (connectionString) {
    const dates = recentDates(boundedDays);
    await ensureTable(connectionString, tableName);
    const filter = dates.map((date) => `PartitionKey eq '${date}'`).join(" or ");
    for await (const entity of getClient(connectionString, tableName).listEntities<AnalyticsRow>({ queryOptions: { filter } })) {
      rows.push({
        partitionKey: String(entity.partitionKey ?? ""),
        rowKey: String(entity.rowKey ?? ""),
        userSub: String(entity.userSub ?? ""),
        userEmail: String(entity.userEmail ?? ""),
        includeWeb: Boolean(entity.includeWeb),
        questionLength: Number(entity.questionLength ?? 0),
        historyCount: Number(entity.historyCount ?? 0),
        status: entity.status === "aborted" || entity.status === "error" ? entity.status : "complete",
        durationMs: Number(entity.durationMs ?? 0),
        bookHits: Number(entity.bookHits ?? 0),
        inputTokens: Number(entity.inputTokens ?? 0),
        outputTokens: Number(entity.outputTokens ?? 0),
        createdAt: String(entity.createdAt ?? "")
      });
      if (rows.length >= 5000) break;
    }

    await ensureTable(connectionString, feedbackTableName);
    const feedbackFilter = dates.map((date) => `date eq '${date}'`).join(" or ");
    for await (const entity of getClient(connectionString, feedbackTableName).listEntities<FeedbackRow>({ queryOptions: { filter: feedbackFilter } })) {
      feedbackRows.push({
        partitionKey: String(entity.partitionKey ?? ""),
        rowKey: String(entity.rowKey ?? ""),
        userSub: String(entity.userSub ?? ""),
        userEmail: String(entity.userEmail ?? ""),
        messageId: String(entity.messageId ?? ""),
        feedback: entity.feedback === "not_helpful" ? "not_helpful" : "helpful",
        includeWeb: Boolean(entity.includeWeb),
        date: String(entity.date ?? ""),
        updatedAt: String(entity.updatedAt ?? "")
      });
      if (feedbackRows.length >= 5000) break;
    }
  }
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  feedbackRows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { days: boundedDays, rows, feedbackRows };
}

export function summarizeAnalytics(rows: AnalyticsRow[], days: number, feedbackRows: FeedbackRow[] = []) {
  const users = new Set<string>();
  const byUserMap = new Map<string, { userSub: string; userEmail: string; queries: number; webQueries: number; totalInputTokens: number; totalOutputTokens: number }>();
  const byDayMap = new Map<string, { date: string; queries: number; users: Set<string>; webQueries: number; errors: number }>();

  let webQueries = 0;
  let completeCount = 0;
  let errorCount = 0;
  let abortedCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalDurationMs = 0;

  for (const row of rows) {
    users.add(row.userSub);
    if (row.includeWeb) webQueries += 1;
    if (row.status === "complete") completeCount += 1;
    else if (row.status === "error") errorCount += 1;
    else abortedCount += 1;
    totalInputTokens += row.inputTokens;
    totalOutputTokens += row.outputTokens;
    totalDurationMs += row.durationMs;

    const u = byUserMap.get(row.userSub) ?? { userSub: row.userSub, userEmail: row.userEmail, queries: 0, webQueries: 0, totalInputTokens: 0, totalOutputTokens: 0 };
    u.queries += 1;
    if (row.includeWeb) u.webQueries += 1;
    u.totalInputTokens += row.inputTokens;
    u.totalOutputTokens += row.outputTokens;
    byUserMap.set(row.userSub, u);

    const day = byDayMap.get(row.partitionKey) ?? { date: row.partitionKey, queries: 0, users: new Set<string>(), webQueries: 0, errors: 0 };
    day.queries += 1;
    day.users.add(row.userSub);
    if (row.includeWeb) day.webQueries += 1;
    if (row.status === "error") day.errors += 1;
    byDayMap.set(row.partitionKey, day);
  }

  let helpfulCount = 0;
  let notHelpfulCount = 0;
  for (const entry of feedbackRows) {
    if (entry.feedback === "helpful") helpfulCount += 1;
    else notHelpfulCount += 1;
  }

  return {
    days,
    summary: {
      totalQueries: rows.length,
      uniqueUsers: users.size,
      webQueries,
      completeCount,
      errorCount,
      abortedCount,
      totalInputTokens,
      totalOutputTokens,
      avgDurationMs: rows.length ? Math.round(totalDurationMs / rows.length) : 0,
      helpfulCount,
      notHelpfulCount
    },
    byDay: [...byDayMap.values()]
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((day) => ({ date: day.date, queries: day.queries, uniqueUsers: day.users.size, webQueries: day.webQueries, errors: day.errors })),
    byUser: [...byUserMap.values()].sort((a, b) => b.queries - a.queries),
    recent: rows.slice(0, 100),
    recentFeedback: feedbackRows.slice(0, 100)
  };
}

export async function queryChatAnalytics(days = 7) {
  const { days: boundedDays, rows, feedbackRows } = await queryChatAnalyticsRows(days);
  return summarizeAnalytics(rows, boundedDays, feedbackRows);
}

function csvCell(value: string | number | boolean): string {
  const raw = String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function analyticsToCsv(rows: AnalyticsRow[]): string {
  const header = ["createdAt", "date", "userSub", "userEmail", "includeWeb", "status", "durationMs", "questionLength", "historyCount", "bookHits", "inputTokens", "outputTokens"];
  const lines = rows.map((row) => [
    row.createdAt, row.partitionKey, row.userSub, row.userEmail, row.includeWeb, row.status,
    row.durationMs, row.questionLength, row.historyCount, row.bookHits, row.inputTokens, row.outputTokens
  ].map(csvCell).join(","));
  return [header.join(","), ...lines].join("\n");
}

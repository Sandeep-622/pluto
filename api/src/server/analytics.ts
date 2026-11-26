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

function getClient(connectionString: string, name: string): TableClient {
  const allowInsecureConnection = connectionString.includes("http://") || connectionString.includes("DefaultEndpointsProtocol=http");
  return TableClient.fromConnectionString(connectionString, name, { allowInsecureConnection });
}

async function ensureTable(connectionString: string, name: string): Promise<void> {
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

export async function recordChatAnalytics(entry: AnalyticsInput): Promise<void> {
  const connectionString = storageConnectionString();
  if (!connectionString) return;
  try {
    await ensureTable(connectionString, tableName);
    const now = Date.now();
    const createdAt = new Date(now).toISOString();
    const entity: AnalyticsRow = {
      partitionKey: createdAt.slice(0, 10),
      rowKey: `${String(now).padStart(13, "0")}-${randomUUID()}`,
      ...entry,
      createdAt
    };
    await getClient(connectionString, tableName).createEntity(entity);
  } catch (error) {
    console.warn("Analytics write skipped", { type: error instanceof Error ? error.name : "unknown" });
  }
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

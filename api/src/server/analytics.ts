import { TableClient, TableServiceClient } from "@azure/data-tables";
import { createHash, randomUUID } from "node:crypto";
import type { AgeBand, FeedbackReason, FeedbackValue, ProfileResponse, Role, TrackRequest } from "../../../src/lib/contract";

/*
 * Analytics tables (all flat, scalar columns so Power BI's Azure Table Storage connector can load them directly):
 *   plutousers      one row per user      (PK "user", RK userId)  profile + first/last seen
 *   plutosessions   one row per visit     (PK userId, RK sessionId)
 *   plutoactivity   one row per user/day  (PK userId, RK YYYY-MM-DD)  retention source
 *   plutoanalytics  one row per question  (PK date,   RK time-uuid)
 *   plutofeedback   one row per answer    (PK userId, RK messageId)
 *   plutoevents     one row per UI event  (PK date,   RK time-uuid)
 * Fact tables carry only the hashed userId; the email lives in plutousers alone. Question text is never stored.
 */

export type ChatOutcome = "complete" | "aborted" | "error";

export type AnalyticsUser = { sub: string; email: string };

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
  messageId?: string;
  sessionId?: string;
  conversationId?: string;
  webHits?: number;
  answerChars?: number;
  timeToFirstTokenMs?: number;
  noEvidence?: boolean;
  errorSections?: string;
  deployment?: string;
};

export type AnalyticsRow = {
  partitionKey: string;
  rowKey: string;
  createdAt: string;
  userId: string;
  role?: Role;
  ageBand?: AgeBand;
  isFirstQuery: boolean;
  daysSinceFirstSeen: number;
} & Omit<AnalyticsInput, "userSub" | "userEmail">;

export type FeedbackInput = {
  userSub: string;
  userEmail: string;
  messageId: string;
  feedback: FeedbackValue;
  includeWeb: boolean;
  reason?: FeedbackReason;
  sessionId?: string;
  conversationId?: string;
};

export type FeedbackRow = {
  partitionKey: string;
  rowKey: string;
  userId: string;
  messageId: string;
  feedback: FeedbackValue;
  includeWeb: boolean;
  reason?: FeedbackReason;
  sessionId?: string;
  conversationId?: string;
  role?: Role;
  ageBand?: AgeBand;
  date: string;
  createdAt: string;
  updatedAt: string;
  changeCount: number;
  previousFeedback?: FeedbackValue;
};

export type UserRow = {
  partitionKey: string;
  rowKey: string;
  userId: string;
  userEmail: string;
  role?: Role;
  ageBand?: AgeBand;
  profileCompletedAt?: string;
  profileUpdatedAt?: string;
  firstSeenAt: string;
  firstSeenDate: string;
  lastSessionAt?: string;
  lastSessionDate?: string;
  firstQueryAt?: string;
  device?: string;
  locale?: string;
  timeZone?: string;
};

export type SessionRow = {
  partitionKey: string;
  rowKey: string;
  userId: string;
  sessionId: string;
  startedAt?: string;
  startDate?: string;
  lastHeartbeatAt: string;
  activeSeconds: number;
  endedAt?: string;
  endReason?: string;
  isNewUser?: boolean;
  isReturningUser?: boolean;
  daysSinceLastVisit?: number;
  daysSinceFirstSeen?: number;
  role?: Role;
  ageBand?: AgeBand;
  device?: string;
  locale?: string;
  timeZone?: string;
};

const tables = {
  chat: "plutoanalytics",
  feedback: "plutofeedback",
  users: "plutousers",
  sessions: "plutosessions",
  activity: "plutoactivity",
  events: "plutoevents"
} as const;
const usersPartition = "user";
const tableReady = new Map<string, Promise<void>>();

function storageConnectionString(): string | undefined {
  return process.env.ANALYTICS_STORAGE_CONNECTION_STRING?.trim() || process.env.AzureWebJobsStorage?.trim() || undefined;
}

function isInsecure(connectionString: string): boolean {
  return connectionString.includes("http://") || connectionString.includes("DefaultEndpointsProtocol=http");
}

function getClient(connectionString: string, name: string): TableClient {
  return TableClient.fromConnectionString(connectionString, name, { allowInsecureConnection: isInsecure(connectionString) });
}

async function ensureTable(connectionString: string, name: string): Promise<void> {
  const cacheKey = `${connectionString}::${name}`;
  let pending = tableReady.get(cacheKey);
  if (!pending) {
    const service = TableServiceClient.fromConnectionString(connectionString, { allowInsecureConnection: isInsecure(connectionString) });
    pending = service.createTable(name).catch((error: unknown) => {
      if (statusOf(error) !== 409) throw error;
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

function statusOf(error: unknown): number | undefined {
  return typeof error === "object" && error && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : undefined;
}

async function openTable(name: string): Promise<TableClient | undefined> {
  const connectionString = storageConnectionString();
  if (!connectionString) return undefined;
  await ensureTable(connectionString, name);
  return getClient(connectionString, name);
}

async function findEntity<T extends object>(client: TableClient, partitionKey: string, rowKey: string): Promise<T | undefined> {
  try {
    return await client.getEntity<T>(partitionKey, rowKey) as T;
  } catch (error) {
    if (statusOf(error) === 404) return undefined;
    throw error;
  }
}

function clean<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function safeKey(value: string): string {
  return value.replace(/[\\/#?\u0000-\u001f\u007f-\u009f]/g, "_");
}

function warn(label: string, error: unknown): void {
  console.warn(`${label} skipped`, { type: error instanceof Error ? error.name : "unknown" });
}

export function userIdFor(sub: string): string {
  return createHash("sha256").update(`${process.env.ANALYTICS_HASH_SALT ?? ""}${sub}`).digest("hex").slice(0, 32);
}

function dayDiff(later: string, earlier: string): number {
  return Math.max(0, Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000));
}

type Touch = { row: UserRow; isNew: boolean; daysSinceLastVisit?: number };

/** Loads the user row, creating it on first sight. A session start also moves lastSession*. */
async function touchUser(user: AnalyticsUser, now: Date, session?: { device?: string; locale?: string; timeZone?: string }): Promise<Touch | undefined> {
  const client = await openTable(tables.users);
  if (!client) return undefined;
  const userId = userIdFor(user.sub);
  const existing = await findEntity<UserRow>(client, usersPartition, userId);
  const iso = now.toISOString();
  const date = iso.slice(0, 10);
  if (!existing) {
    const row: UserRow = clean({
      partitionKey: usersPartition, rowKey: userId, userId, userEmail: user.email,
      firstSeenAt: iso, firstSeenDate: date,
      lastSessionAt: session ? iso : undefined, lastSessionDate: session ? date : undefined,
      ...session
    });
    await client.upsertEntity(row, "Merge");
    return { row, isNew: true };
  }
  if (!session) return { row: existing, isNew: false };
  const update = clean({
    partitionKey: usersPartition, rowKey: userId, userEmail: user.email,
    lastSessionAt: iso, lastSessionDate: date, device: session.device, locale: session.locale, timeZone: session.timeZone
  });
  await client.upsertEntity(update, "Merge");
  return {
    row: { ...existing, ...update },
    isNew: false,
    daysSinceLastVisit: existing.lastSessionDate ? dayDiff(date, existing.lastSessionDate) : undefined
  };
}

async function markActivity(userId: string, now: Date, user: UserRow, flag: "hadSession" | "hadQuery"): Promise<void> {
  const client = await openTable(tables.activity);
  if (!client) return;
  const iso = now.toISOString();
  const date = iso.slice(0, 10);
  await client.upsertEntity(clean({
    partitionKey: userId, rowKey: date, userId, activityDate: date, lastActiveAt: iso,
    daysSinceFirstSeen: dayDiff(date, user.firstSeenDate), role: user.role, ageBand: user.ageBand, [flag]: true
  }), "Merge");
}

export async function recordChatAnalytics(entry: AnalyticsInput): Promise<void> {
  try {
    const chat = await openTable(tables.chat);
    if (!chat) return;
    const now = new Date();
    const createdAt = now.toISOString();
    const { userSub, userEmail, ...fields } = entry;
    const userId = userIdFor(userSub);
    const touch = await touchUser({ sub: userSub, email: userEmail }, now);
    const entity: AnalyticsRow = clean({
      partitionKey: createdAt.slice(0, 10),
      rowKey: `${String(now.getTime()).padStart(13, "0")}-${randomUUID()}`,
      ...fields,
      userId,
      role: touch?.row.role,
      ageBand: touch?.row.ageBand,
      isFirstQuery: !touch?.row.firstQueryAt,
      daysSinceFirstSeen: touch ? dayDiff(createdAt.slice(0, 10), touch.row.firstSeenDate) : 0,
      createdAt
    });
    await chat.createEntity(entity);
    if (touch) {
      const users = await openTable(tables.users);
      if (!touch.row.firstQueryAt) await users?.upsertEntity({ partitionKey: usersPartition, rowKey: userId, firstQueryAt: createdAt }, "Merge");
      await markActivity(userId, now, touch.row, "hadQuery");
    }
  } catch (error) {
    warn("Analytics write", error);
  }
}

export async function recordFeedback(entry: FeedbackInput): Promise<void> {
  try {
    const client = await openTable(tables.feedback);
    if (!client) return;
    const now = new Date();
    const updatedAt = now.toISOString();
    const { userSub, userEmail, ...fields } = entry;
    const userId = userIdFor(userSub);
    const [existing, touch] = await Promise.all([
      findEntity<FeedbackRow>(client, userId, safeKey(entry.messageId)),
      touchUser({ sub: userSub, email: userEmail }, now)
    ]);
    const changed = existing && existing.feedback !== entry.feedback;
    const entity: FeedbackRow = clean({
      partitionKey: userId,
      rowKey: safeKey(entry.messageId),
      ...fields,
      // A reason-only follow-up keeps the vote it belongs to.
      userId,
      role: touch?.row.role,
      ageBand: touch?.row.ageBand,
      date: updatedAt.slice(0, 10),
      createdAt: existing?.createdAt ?? updatedAt,
      updatedAt,
      changeCount: (existing?.changeCount ?? 0) + (changed ? 1 : 0),
      previousFeedback: changed ? existing.feedback : existing?.previousFeedback,
      reason: entry.reason ?? (changed ? undefined : existing?.reason),
      sessionId: entry.sessionId ?? existing?.sessionId,
      conversationId: entry.conversationId ?? existing?.conversationId
    });
    await client.upsertEntity(entity, "Replace");
  } catch (error) {
    warn("Feedback write", error);
  }
}

/** Returns undefined only when the lookup failed, so the UI can fail open instead of re-prompting everyone. */
export async function getProfile(user: AnalyticsUser): Promise<ProfileResponse | undefined> {
  try {
    const client = await openTable(tables.users);
    if (!client) return { completed: false };
    const row = await findEntity<UserRow>(client, usersPartition, userIdFor(user.sub));
    return row?.role && row.ageBand ? { completed: true, role: row.role, ageBand: row.ageBand } : { completed: false };
  } catch (error) {
    warn("Profile read", error);
    return undefined;
  }
}

/** Returns false when the write failed. With no storage configured there is nothing to lose, so it succeeds. */
export async function saveProfile(user: AnalyticsUser, profile: { role: Role; ageBand: AgeBand }): Promise<boolean> {
  try {
    const client = await openTable(tables.users);
    if (!client) return true;
    const now = new Date();
    const iso = now.toISOString();
    const userId = userIdFor(user.sub);
    const existing = await findEntity<UserRow>(client, usersPartition, userId);
    await client.upsertEntity(clean({
      partitionKey: usersPartition, rowKey: userId, userId, userEmail: user.email,
      firstSeenAt: existing ? undefined : iso, firstSeenDate: existing ? undefined : iso.slice(0, 10),
      role: profile.role, ageBand: profile.ageBand,
      profileCompletedAt: existing?.profileCompletedAt ?? iso, profileUpdatedAt: iso
    }), "Merge");
    const events = await openTable(tables.events);
    await events?.createEntity(eventRow(now, userId, undefined, "profile_completed", `${profile.role}|${profile.ageBand}`));
    return true;
  } catch (error) {
    warn("Profile write", error);
    return false;
  }
}

function eventRow(now: Date, userId: string, sessionId: string | undefined, eventName: string, detail?: string, includeWeb?: boolean) {
  const createdAt = now.toISOString();
  return clean({
    partitionKey: createdAt.slice(0, 10),
    rowKey: `${String(now.getTime()).padStart(13, "0")}-${randomUUID()}`,
    userId, sessionId, eventName, detail, includeWeb, createdAt
  });
}

/** Records session lifecycle and UI events. Never throws; analytics must not affect the app. */
export async function recordTrack(user: AnalyticsUser, event: TrackRequest): Promise<void> {
  try {
    const now = new Date();
    const iso = now.toISOString();
    const userId = userIdFor(user.sub);
    const sessionKey = safeKey(event.sessionId);
    if (event.type === "ui") {
      const events = await openTable(tables.events);
      await events?.createEntity(eventRow(now, userId, event.sessionId, event.name, event.detail, event.includeWeb));
      return;
    }
    const sessions = await openTable(tables.sessions);
    if (!sessions) return;
    if (event.type === "session_start") {
      const known = await findEntity<SessionRow>(sessions, userId, sessionKey);
      const touch = await touchUser(user, now, { device: event.device, locale: event.locale, timeZone: event.timeZone });
      if (known) {
        await sessions.upsertEntity({ partitionKey: userId, rowKey: sessionKey, lastHeartbeatAt: iso }, "Merge");
        return;
      }
      const row: SessionRow = clean({
        partitionKey: userId, rowKey: sessionKey, userId, sessionId: event.sessionId,
        startedAt: iso, startDate: iso.slice(0, 10), lastHeartbeatAt: iso, activeSeconds: 0,
        isNewUser: touch?.isNew, isReturningUser: touch ? !touch.isNew : undefined,
        daysSinceLastVisit: touch?.daysSinceLastVisit,
        daysSinceFirstSeen: touch ? dayDiff(iso.slice(0, 10), touch.row.firstSeenDate) : undefined,
        role: touch?.row.role, ageBand: touch?.row.ageBand,
        device: event.device, locale: event.locale, timeZone: event.timeZone
      });
      await sessions.upsertEntity(row, "Merge");
      if (touch) await markActivity(userId, now, touch.row, "hadSession");
      return;
    }
    await sessions.upsertEntity(clean({
      partitionKey: userId, rowKey: sessionKey, userId, sessionId: event.sessionId,
      lastHeartbeatAt: iso, activeSeconds: event.activeSeconds,
      endedAt: event.type === "session_end" ? iso : undefined, endReason: event.type === "session_end" ? "signout" : undefined
    }), "Merge");
  } catch (error) {
    warn("Tracking write", error);
  }
}

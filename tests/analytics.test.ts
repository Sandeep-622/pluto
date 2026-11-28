import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Entity = Record<string, unknown> & { partitionKey: string; rowKey: string };
const store = vi.hoisted(() => new Map<string, Map<string, Record<string, unknown>>>());

vi.mock("@azure/data-tables", () => {
  class FakeClient {
    constructor(private readonly name: string) {}
    private get rows() {
      if (!store.has(this.name)) store.set(this.name, new Map());
      return store.get(this.name)!;
    }
    static fromConnectionString(_connection: string, name: string) { return new FakeClient(name); }
    async createEntity(entity: Entity) {
      const key = `${entity.partitionKey}|${entity.rowKey}`;
      if (this.rows.has(key)) throw Object.assign(new Error("exists"), { statusCode: 409 });
      this.rows.set(key, { ...entity });
    }
    async upsertEntity(entity: Entity, mode: "Merge" | "Replace") {
      const key = `${entity.partitionKey}|${entity.rowKey}`;
      this.rows.set(key, mode === "Merge" ? { ...this.rows.get(key), ...entity } : { ...entity });
    }
    async getEntity(partitionKey: string, rowKey: string) {
      const row = this.rows.get(`${partitionKey}|${rowKey}`);
      if (!row) throw Object.assign(new Error("missing"), { statusCode: 404 });
      return { ...row };
    }
  }
  class FakeService {
    static fromConnectionString() { return new FakeService(); }
    async createTable() { /* tables are implicit in the fake */ }
  }
  return { TableClient: FakeClient, TableServiceClient: FakeService };
});

import { getProfile, recordChatAnalytics, recordFeedback, recordTrack, saveProfile, userIdFor } from "@api/server/analytics";

const user = { sub: "sub-1", email: "reader@example.com" };
const rows = (table: string) => [...(store.get(table)?.values() ?? [])];
const chatInput = {
  userSub: user.sub, userEmail: user.email, includeWeb: false, questionLength: 10, historyCount: 0,
  status: "complete" as const, durationMs: 120, bookHits: 2, inputTokens: 80, outputTokens: 30
};

beforeEach(() => { store.clear(); vi.stubEnv("ANALYTICS_STORAGE_CONNECTION_STRING", "UseDevelopmentStorage=true"); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("Table Storage analytics writers", () => {
  it("skips writes cleanly when no storage connection string is configured", async () => {
    vi.stubEnv("ANALYTICS_STORAGE_CONNECTION_STRING", "");
    vi.stubEnv("AzureWebJobsStorage", "");
    await expect(recordChatAnalytics(chatInput)).resolves.toBeUndefined();
    await expect(recordFeedback({ userSub: user.sub, userEmail: user.email, messageId: "msg-1", feedback: "helpful", includeWeb: false })).resolves.toBeUndefined();
    await expect(recordTrack(user, { type: "session_heartbeat", sessionId: "session-1", activeSeconds: 5 })).resolves.toBeUndefined();
    await expect(getProfile(user)).resolves.toEqual({ completed: false });
    await expect(saveProfile(user, { role: "doctor", ageBand: "25_34" })).resolves.toBe(true);
    expect(store.size).toBe(0);
  });

  it("hashes the Google subject and keeps the email only in the users table", async () => {
    await recordChatAnalytics(chatInput);
    const userId = userIdFor(user.sub);
    expect(userId).toMatch(/^[0-9a-f]{32}$/);
    expect(userId).not.toContain(user.sub);
    const [chat] = rows("plutoanalytics");
    expect(chat).toMatchObject({ userId, isFirstQuery: true, daysSinceFirstSeen: 0, bookHits: 2, status: "complete" });
    expect(JSON.stringify(chat)).not.toContain(user.email);
    expect(chat).not.toHaveProperty("userSub");
    expect(rows("plutousers")[0]).toMatchObject({ userId, userEmail: user.email });
  });

  it("stores the profile once and copies role and age band onto later rows", async () => {
    expect(await getProfile(user)).toEqual({ completed: false });
    expect(await saveProfile(user, { role: "mbbs_student", ageBand: "18_24" })).toBe(true);
    expect(await getProfile(user)).toEqual({ completed: true, role: "mbbs_student", ageBand: "18_24" });
    const completedAt = rows("plutousers")[0].profileCompletedAt;

    await recordChatAnalytics({ ...chatInput, messageId: "message-0001", sessionId: "session-0001", conversationId: "conv-00001", webHits: 3, noEvidence: false });
    await recordChatAnalytics(chatInput);
    const chats = rows("plutoanalytics");
    expect(chats[0]).toMatchObject({ role: "mbbs_student", ageBand: "18_24", messageId: "message-0001", sessionId: "session-0001", webHits: 3 });
    expect(chats.filter((row) => row.isFirstQuery === true)).toHaveLength(1);
    expect(rows("plutousers")[0]).toMatchObject({ profileCompletedAt: completedAt });
    expect(rows("plutoevents").map((row) => row.eventName)).toContain("profile_completed");
  });

  it("records sessions with active time, new versus returning visits and one activity row per day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-01T10:00:00Z"));
    await recordTrack(user, { type: "session_start", sessionId: "session-0001", device: "desktop", locale: "en-IN", timeZone: "Asia/Kolkata" });
    vi.setSystemTime(new Date("2026-03-01T10:05:00Z"));
    await recordTrack(user, { type: "session_heartbeat", sessionId: "session-0001", activeSeconds: 240 });
    await recordTrack(user, { type: "session_end", sessionId: "session-0001", activeSeconds: 250 });
    vi.setSystemTime(new Date("2026-03-04T09:00:00Z"));
    await recordTrack(user, { type: "session_start", sessionId: "session-0002", device: "mobile" });
    await recordChatAnalytics(chatInput);

    const sessions = rows("plutosessions");
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({
      isNewUser: true, isReturningUser: false, activeSeconds: 250, device: "desktop", timeZone: "Asia/Kolkata",
      startedAt: "2026-03-01T10:00:00.000Z", endReason: "signout", daysSinceFirstSeen: 0
    });
    expect(sessions[1]).toMatchObject({ isNewUser: false, isReturningUser: true, daysSinceLastVisit: 3, daysSinceFirstSeen: 3 });
    const activity = rows("plutoactivity").sort((a, b) => String(a.rowKey).localeCompare(String(b.rowKey)));
    expect(activity.map((row) => row.rowKey)).toEqual(["2026-03-01", "2026-03-04"]);
    expect(activity[1]).toMatchObject({ hadSession: true, hadQuery: true, daysSinceFirstSeen: 3 });
    expect(rows("plutousers")[0]).toMatchObject({ firstSeenDate: "2026-03-01", lastSessionDate: "2026-03-04" });
  });

  it("does not reset a session when a start is repeated", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-01T10:00:00Z"));
    await recordTrack(user, { type: "session_start", sessionId: "session-0001", device: "desktop" });
    vi.setSystemTime(new Date("2026-03-01T10:10:00Z"));
    await recordTrack(user, { type: "session_start", sessionId: "session-0001", device: "desktop" });
    expect(rows("plutosessions")[0]).toMatchObject({ startedAt: "2026-03-01T10:00:00.000Z", lastHeartbeatAt: "2026-03-01T10:10:00.000Z" });
  });

  it("records UI events and keeps feedback history, reasons and vote changes", async () => {
    await recordTrack(user, { type: "ui", sessionId: "session-0001", name: "web_toggled", detail: "on", includeWeb: true });
    expect(rows("plutoevents")[0]).toMatchObject({ eventName: "web_toggled", detail: "on", includeWeb: true, userId: userIdFor(user.sub) });

    const base = { userSub: user.sub, userEmail: user.email, messageId: "message-0001", includeWeb: false, sessionId: "session-0001", conversationId: "conv-00001" };
    await recordFeedback({ ...base, feedback: "not_helpful" });
    await recordFeedback({ ...base, feedback: "not_helpful", reason: "bad_sources" });
    await recordFeedback({ ...base, feedback: "helpful" });
    const [row] = rows("plutofeedback");
    expect(rows("plutofeedback")).toHaveLength(1);
    expect(row).toMatchObject({ feedback: "helpful", previousFeedback: "not_helpful", changeCount: 1, conversationId: "conv-00001" });
    expect(row).not.toHaveProperty("reason");
    await recordFeedback({ ...base, feedback: "not_helpful", reason: "inaccurate" });
    expect(rows("plutofeedback")[0]).toMatchObject({ feedback: "not_helpful", reason: "inaccurate", changeCount: 2 });
  });

  it("never throws when storage fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    store.set("plutousers", new Proxy(new Map(), { get() { throw Object.assign(new Error("down"), { statusCode: 500 }); } }));
    await expect(recordChatAnalytics(chatInput)).resolves.toBeUndefined();
    await expect(getProfile(user)).resolves.toBeUndefined();
    await expect(saveProfile(user, { role: "doctor", ageBand: "35_44" })).resolves.toBe(false);
  });
});

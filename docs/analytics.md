# Analytics and Power BI

Pluto writes usage analytics to Azure Table Storage (`ANALYTICS_STORAGE_CONNECTION_STRING`, falling back to
`AzureWebJobsStorage`). Tables are created on first write. Every column is a flat scalar so Power BI can load it directly.

Privacy: fact tables hold only `userId` (a salted SHA-256 of the Google subject). The email lives in `plutousers` alone.
The text of a question or answer is never stored.

## Tables

| Table | Partition key | Row key | One row per |
|---|---|---|---|
| `plutousers` | `user` | `userId` | user: profile, first/last seen |
| `plutosessions` | `userId` | `sessionId` | visit |
| `plutoactivity` | `userId` | `YYYY-MM-DD` | user per active day (retention source) |
| `plutoanalytics` | `YYYY-MM-DD` | time-uuid | question asked |
| `plutofeedback` | `userId` | `messageId` | answer rated (latest vote kept) |
| `plutoevents` | `YYYY-MM-DD` | time-uuid | UI event |

### plutousers
`userId, userEmail, role, ageBand, profileCompletedAt, profileUpdatedAt, firstSeenAt, firstSeenDate, lastSessionAt, lastSessionDate, firstQueryAt, device, locale, timeZone`

`role`: doctor, resident, mbbs_student, phd_researcher, nursing_allied, pharmacy, other.
`ageBand`: under_18, 18_24, 25_34, 35_44, 45_54, 55_plus, prefer_not_to_say.

### plutosessions
`userId, sessionId, startedAt, startDate, lastHeartbeatAt, activeSeconds, endedAt, endReason, isNewUser, isReturningUser, daysSinceLastVisit, daysSinceFirstSeen, role, ageBand, device, locale, timeZone`

- `activeSeconds`: time the tab was visible *and* the reader interacted in the last 60 s. Use this, not `lastHeartbeatAt - startedAt`, for time spent.
- `lastHeartbeatAt - startedAt` is the wall-clock length of the visit.
- `endedAt` is set only on explicit sign-out. A closed tab has a final heartbeat but no `endedAt`.
- A session is a browser tab; it continues across reloads and ends after 30 minutes without interaction.
- Google sign-in tokens last about an hour, so a visit longer than that ends at the re-sign-in.

### plutoactivity
`userId, activityDate, lastActiveAt, daysSinceFirstSeen, role, ageBand, hadSession, hadQuery`

### plutoanalytics
`userId, createdAt, messageId, sessionId, conversationId, role, ageBand, isFirstQuery, daysSinceFirstSeen, includeWeb, questionLength, historyCount, status (complete|aborted|error), durationMs, timeToFirstTokenMs, bookHits, webHits, noEvidence, answerChars, errorSections, inputTokens, outputTokens, deployment`

### plutofeedback
`userId, messageId, sessionId, conversationId, feedback (helpful|not_helpful), reason, previousFeedback, changeCount, includeWeb, role, ageBand, date, createdAt, updatedAt`

`reason` (inaccurate, not_relevant, incomplete, bad_sources, other) is optional and only asked after "Not helpful".
Join to `plutoanalytics` on `messageId`.

### plutoevents
`userId, sessionId, eventName, detail, includeWeb, createdAt`

`eventName`: profile_completed, suggestion_clicked, web_toggled, new_chat, conversation_opened, conversation_deleted,
history_cleared, citation_clicked, query_stopped, feedback_reason_shown, sign_out.

## Connecting Power BI

1. Power BI Desktop → Get data → Azure → **Azure Table Storage**, enter the storage account name and a key.
   Use a dedicated read-only SAS or rotate the key if the report is shared.
2. Load all six tables. In Power Query expand each `Content` column and set types: ISO `*At` columns to Date/Time,
   `*Date` columns to Date, counts and `*Ms`/`*Seconds` to Whole number.
3. Relationships (all many-to-one into `plutousers[userId]`): `plutosessions`, `plutoactivity`, `plutoanalytics`, `plutofeedback`, `plutoevents`.
   Add `plutofeedback[messageId]` → `plutoanalytics[messageId]` as a second relationship.
4. Add a Date table and relate it to `plutoactivity[activityDate]`.
5. Table Storage supports import mode only and each refresh reads the whole table. If refreshes get slow, add a nightly
   rollup into Azure SQL and point Power BI at that.

## Starter measures

```DAX
Active Users (DAU) = DISTINCTCOUNT ( plutoactivity[userId] )
New Users = CALCULATE ( DISTINCTCOUNT ( plutousers[userId] ), plutousers[firstSeenDate] IN VALUES ( 'Date'[Date] ) )
Queries = COUNTROWS ( plutoanalytics )
Queries per Active User = DIVIDE ( [Queries], [Active Users (DAU)] )
Avg Active Minutes / Session = DIVIDE ( AVERAGE ( plutosessions[activeSeconds] ), 60 )
Helpful Rate = DIVIDE ( CALCULATE ( COUNTROWS ( plutofeedback ), plutofeedback[feedback] = "helpful" ), COUNTROWS ( plutofeedback ) )
No-Evidence Rate = DIVIDE ( CALCULATE ( COUNTROWS ( plutoanalytics ), plutoanalytics[noEvidence] = TRUE ), [Queries] )

-- Day-N retention: of users seen on their first day, the share who were active exactly N days later.
-- Do not put the Date table on this visual; it filters both sides to the same day.
D1 Retention =
VAR Cohort = CALCULATETABLE ( VALUES ( plutoactivity[userId] ), plutoactivity[daysSinceFirstSeen] = 0 )
VAR Returned = CALCULATETABLE ( VALUES ( plutoactivity[userId] ), plutoactivity[daysSinceFirstSeen] = 1 )
RETURN DIVIDE ( COUNTROWS ( INTERSECT ( Cohort, Returned ) ), COUNTROWS ( Cohort ) )
```

Duplicate `D1 Retention` for 7 and 30 days by changing `daysSinceFirstSeen`.
These measures are starting points and have not been run in Power BI yet. Slice any measure by `role`, `ageBand`, `device` or `includeWeb`.

## Not yet captured

- Anything before this change: older rows have no `userId`, session, or profile columns.
- Question text or topic. Add a coarse topic classifier only after deciding it is acceptable to store.
- Sessions longer than the Google token lifetime, and visits where the browser blocks `sessionStorage`.

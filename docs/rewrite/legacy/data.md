# Legacy data model

Reference for the rewrite (NestJS + PostgreSQL/Kysely, read-only mysql2 access to the Issabel PBX). It describes how the legacy Node app under `legacy/` stores and reads data. Everything here comes from reading the code at commit `63352e3`. No production database was inspected.

Markers used below:

- **[?]** means the code alone can't settle it. Check it against production (`/opt/call-center/data/…`, the PBX) before relying on it.
- **DEAD-W** means the data is written but never read by any live code path.
- **DEAD-R** means the data is read but never written.
- **SYNTH** means the data is synthetic or fabricated, not measured.

File references are relative to `legacy/`.

---

## 0. Storage inventory

| Store | Location (prod) | Owner / opened by | Notes |
|---|---|---|---|
| SQLite `callcenter.db` (+`-wal`,`-shm`) | `data/callcenter.db` → `/opt/call-center/data/callcenter.db` | `services/dbService.js` (main handle, shared by `authService` and `webauthnService`); separate `DatabaseSync` handles in `sttService`, `sttCleanerService`, `topicAnalyticsService`, `blacklistService` | 18 tables. WAL mode. Five independent connections to the same file. |
| JSON files | `data/*.json`, `system_settings.json` (repo root), `viewer/data/*.json`, `scratch/*.json` | various, see §2 | Whole-file rewrite on every change (`fs.writeFileSync`). No locking. |
| Binary/blob files | `data/temp_zips/`, `scratch/calls/`, `public/samples/candidates/`, `viewer/public/uploads/tickets/`, `data/zuhra_profile_ensemble.pt` | see §2.4 | |
| Redis | `REDIS_HOST:REDIS_PORT` | `issabelDbService` | Cache only (TTL ≤ 7 days). Nothing to migrate. |
| PBX MariaDB | `asteriskcdrdb`, `asterisk` on the PBX (default `192.168.0.124`) | `issabelDbService`, `syncService` | Read only, via `ssh root@pbx 'mysql -N -B'` with SQL on stdin. |
| PBX AstDB / queue runtime | Asterisk on the PBX | `blacklistService`, `app.js`, `amiService` | Written via `asterisk -rx` over SSH and via AMI. See §4. |

**The viewer's service copies are dead code.** `viewer/services/{dbService,issabelDbService,blacklistService,amiService,syncService,exportService,redisService}.js` are forks, and `viewer/app.js` requires none of them. It requires only `ticketService`, `uzcryptoService` and `rateLimitService`. The viewer has no SQLite database at runtime. It proxies auth and WebAuthn to the main app on port 3535 and keeps three JSON files (§2).

---

## 1. SQLite `callcenter.db`

### 1.0 Connection, pragmas, time formats

- `dbService`: `PRAGMA journal_mode=WAL; busy_timeout=10000; synchronous=NORMAL`.
- `sttService` and `topicAnalyticsService`: WAL and `busy_timeout` only.
- `sttCleanerService` and `blacklistService`: no pragmas.
- `PRAGMA foreign_keys=ON` is set only on dbService's handle, by `webauthnService.migrate()`. The single FK, `auth_passkeys.user_id → auth_users.id ON DELETE CASCADE`, is therefore enforced only for statements issued through that handle. In practice that covers every auth write.
- Schema is created with `CREATE TABLE IF NOT EXISTS` at process start. Columns added later use `ALTER TABLE … ADD COLUMN` inside try/catch (§1.2). There is no schema-version table.

The timestamp formats are mixed. This matters for migration.

| Format | Produced by | Timezone |
|---|---|---|
| `YYYY-MM-DD HH:MM:SS` via `toLocaleString('sv-SE',{timeZone:'Asia/Tashkent'})` | dbService event/call times, callbacks `call_time` | Asia/Tashkent wall clock |
| `datetime('now','localtime')` (SQLite default) | most `created_at`/`updated_at` in dbService, authService, passkeys | **server OS local TZ [?]** (prod server TZ unknown; probably Asia/Tashkent) |
| `CURRENT_TIMESTAMP` / `datetime('now')` | `blacklist`, `call_transcriptions`, `stt_learned_rules`, `call_topic_analytics` | **UTC** |
| `new Date().toISOString()` (`…T…Z`) | `auth_sessions.expires_at`, `auth_lockouts.locked_until/last_attempt` | UTC, ISO-8601 |
| epoch milliseconds (INTEGER) | `auth_password_resets.*_at`, `auth_email_verifications.*_at` | UTC |
| PBX `cdr.calldate` copied verbatim | `pending_callbacks.call_time` (from CDR sync), `agent_3cx_call_logs` rows backfilled from CDR | PBX MariaDB local TZ [?] |
| 3CX agent `startTime` with `/` replaced by `-` | `agent_3cx_call_logs.event_time/start_time/end_time` | agent PC local [?]. The format is whatever the desktop agent sends. Check with `SELECT DISTINCT length(event_time), substr(event_time,11,1) FROM agent_3cx_call_logs`. |

Known bug caused by the mixed formats: `app.js` lines 1374 and 1471 compare `auth_sessions.expires_at` (ISO, contains `T`) with `datetime('now','localtime')` (contains a space). The comparison is lexicographic, so on the same day the session always looks unexpired.

### 1.1 Tables

#### 1.1.1 `calls` (dbService). **DEAD-R in practice; feeds only SYNTH topic analytics**

| Column | Type | Default / constraint | Notes |
|---|---|---|---|
| id | TEXT | PRIMARY KEY | `Date.now() + random 4 chars` (AMI) |
| channel | TEXT | | AMI channel name |
| caller_id | TEXT | | |
| operator | TEXT | | display string, e.g. `Oybek (101)`, `Navbat (Kutishda uzildi)` |
| operator_exten | TEXT | | |
| direction | TEXT | `'inbound'` | `inbound`, `outbound` or `transfer` |
| status | TEXT | `'ANSWERED'` | `ANSWERED`, `ABANDONED` or `NO ANSWER` |
| hangup_party | TEXT | | Uzbek free text (`Mijoz tugatdi`, …) |
| duration | INTEGER | 0 | talk seconds |
| cause | TEXT | | e.g. `Hangup (16)`, `QueueCallerAbandon`, `AgentComplete (…)` |
| created_at | TEXT | | Tashkent local `YYYY-MM-DD HH:MM:SS` |

- Indexes: `idx_calls_created_at (created_at DESC)`, `idx_calls_caller_id`, `idx_calls_operator_exten`.
- Writer: `dbService.saveCall()` (`INSERT OR REPLACE`), called from `amiService` on `AgentComplete`, `QueueCallerAbandon` and `Hangup` (lines ≈1283, 1522, 1927). Calls from `712020159`, `*2020159` or caller IDs shorter than 7 chars are skipped. Each write also calls `incrementOperatorDaily` (§1.1.2).
- Readers: `getCallsPaginated` (only from `amiService.getCallHistoryPaginated`, which is never called), `getTodaySummary` and `getHourlyStats` (never called). The only live reader is `topicAnalyticsService` (seed and `analyze…`), which fabricates topics from it.
- Purpose: a real-time AMI-derived call log, superseded by reading CDR directly. **Drop.**

#### 1.1.2 `operator_daily_stats` (dbService). **DEAD-W**

| Column | Type | Default | Notes |
|---|---|---|---|
| stat_date | TEXT | | `YYYY-MM-DD` (PK part) |
| operator_id | TEXT | | extension (PK part) |
| total_calls | INTEGER | 0 | |
| answered | INTEGER | 0 | |
| client_hangup | INTEGER | 0 | answered and hangup_party contains `Mijoz` (or empty) |
| operator_hangup | INTEGER | 0 | answered and hangup_party contains `Operator` |
| denied | INTEGER | 0 | |
| total_duration_sec | INTEGER | 0 | |
| missed | INTEGER | 0 | added by ALTER |

- Primary key: `(stat_date, operator_id)`.
- Writers: `incrementOperatorDaily` (from `saveCall`, 08:00–21:00 only), plus `recordOperatorReject` and `recordOperatorMissed`, which nothing calls.
- Readers: none. **Drop.**

#### 1.1.3 `operator_reject_events` (dbService). **DEAD-R**

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | |
| event_time | TEXT | Tashkent local |
| operator_id | TEXT | |
| caller_id | TEXT | `'Yashirin raqam'` (hidden number) when empty |
| channel | TEXT | `'3CX-Agent'`, with ` (Ish vaqtidan tashqari)` appended outside working hours |

- Indexes: `idx_reject_events_time (event_time)`, `idx_reject_events_op (operator_id)`.
- Writer: `recordOperatorReject()`. **No caller exists** in main code, scripts or app.js. Only the dead viewer fork defines it.
- Readers:
  - `getTodayOperatorRejects(date)` counts `COUNT(DISTINCT event_time)` per operator within 08:00–21:00 inclusive. This feeds `denied`, `deniedCalls` and `denyRate` in every KPI payload.
  - `getRejectEventsPaginated` backs `/api/calls/details?type=denied`.
- Consequence: the "Denied / Rad etilgan" KPI is always 0 unless rows survive from older versions [?]. Check `SELECT COUNT(*), MAX(event_time) FROM operator_reject_events`.

#### 1.1.4 `operator_missed_events` (dbService). **DEAD-R**

The columns, indexes and dedup rule are the same as `operator_reject_events`. The default channel is `'AMI-Missed'`, and the indexes are `idx_missed_events_time` and `idx_missed_events_op`.

- Writer: `recordOperatorMissed()`. Not called. An `app.js:3766` comment says this was intentionally abandoned.
- Reader: fallback branch in `getTodayOperatorMissed`. It is used for an operator only when that operator has no `agent_3cx_call_logs` count.

#### 1.1.5 `agent_3cx_call_logs` (dbService). **LIVE, migrate**

This is the call journal pushed by the "3CX Desktop Agent" running on each operator PC. It is backfilled from CDR by `syncService`, and it is the **only source for per-operator "missed" counts** and the `/operators` page.

| Column | Type | Default | Notes |
|---|---|---|---|
| id | INTEGER PK AUTOINCREMENT | | |
| event_time | TEXT | | = startTime (normalised `/`→`-`), else now (Tashkent) |
| operator_id | TEXT | | extension |
| caller_id | TEXT | | counterpart number, or `'Yashirin raqam'` (hidden) |
| event_type | TEXT | | See the event_type values below. |
| duration_sec | INTEGER | 0 | |
| start_time | TEXT | | raw from agent |
| end_time | TEXT | | |
| hostname | TEXT | | operator PC name; `'Asterisk PBX'` for CDR-backfilled rows |
| details | TEXT | | free text; CDR rows use `3CX Qabul qilindi (Asterisk CDR sinxron): <calldate>` or `3CX Chiquvchi (…)` |

event_type values:

- Observed: `ANSWERED`, `MISSED`, `DIALLED`, `OUTBOUND`, `INCOMING`, `REJECT`, `RINGING`, `ENDED`, `INFO`, `UNKNOWN`, plus numeric codes `'1'` (dialled) and `'2'` (answered) [?].
- `recordAgentCallLog` stores the type **as sent** (not upper-cased). `recordAgentCallLogsBatch` rewrites `ANSWERED` with duration 0 to `MISSED`.

Indexes:

- `idx_3cx_logs_time (event_time)`
- `idx_3cx_logs_op (operator_id)`
- `idx_3cx_logs_type (event_type)`
- `idx_3cx_logs_op_time (operator_id, event_time)`
- **UNIQUE** `idx_3cx_unique_call (operator_id, caller_id, start_time)`

Writers:

- `POST /api/agent/call-event` → `recordAgentCallLog`. Deduplication:
  - A `MISSED` row is skipped if the same operator and caller already have a `MISSED` row within ±90 s.
  - Any row is skipped if the same (operator, caller, details) already exists.
  - Inserts use `INSERT OR IGNORE`.
- `POST /api/agent/sync-batch` → `recordAgentCallLogsBatch` (transaction, same 90 s MISSED dedup).
- `syncService.syncDailyCdrToAgentLogs` runs every 15 min and at 21:00 Tashkent. It inserts CDR-answered inbound and outbound calls missing from the journal (same operator, last-9-digit phone match, ±120 s) with `hostname='Asterisk PBX'`.
- `scripts/cleanup_missed_dupes.js` is a manual DELETE of duplicate MISSED rows for today.

Readers:

- `getTodayAgentOperatorStats`, which applies a "caller_id longer than 4 chars" filter to exclude internal operator-to-operator calls:
  - answered = `event_type IN ('ANSWERED','2') AND duration_sec>0`
  - outbound = `event_type IN ('DIALLED','1') AND duration_sec>0`
  - missed = `event_type='MISSED' OR (duration_sec=0 AND event_type NOT IN ('DIALLED','1'))`. This also counts zero-length `RINGING`, `ENDED` and `INFO` rows as missed, which is a likely bug.
- `getTodayOperatorMissed` uses the same missed rule, limited to 08:00–21:00.
- `getMissedEventsPaginated`, `getAgentCallLogsPaginated` (maps types to display categories), `getTopClients` (fallback), `issabelDbService.fetchCallsDetail` (merges today's agent rows not found in CDR), `syncService` (dedup), `exportService`, `amiService`.

#### 1.1.6 `pending_callbacks` (dbService). **LIVE, migrate (all statuses)**

This is the callback worklist ("Bog'lanishi kerak bo'lgan mijozlar", customers to call back).

| Column | Type | Default | Notes |
|---|---|---|---|
| id | INTEGER PK AUTOINCREMENT | | |
| phone | TEXT NOT NULL | | normalised 9-digit (see `normalizePhone`, §3.2) |
| caller_name | TEXT | | always `''` (no writer passes a name). **DEAD** |
| source | TEXT NOT NULL | | `abandoned` or `ivr_non_working`. `manual` is mentioned in a comment but never written. |
| call_time | TEXT NOT NULL | | last missed call time (CDR `calldate` or AMI Tashkent local) |
| attempts_count | INTEGER | 1 | distinct missed-call channels in the sync window |
| today_attempts | INTEGER | 1 | in CREATE and also re-ALTERed |
| status | TEXT | `'pending'` | `pending`, `resolved` or `dismissed` |
| dismissed_at | TEXT | | **set for both dismissed and resolved** (close time, server local) |
| dismissed_by | TEXT | | dismiss: actor username. Resolve: tag such as `operator_101_inbound`, `operator_101_outbound`, `3cx_answered_101`, `3cx_ended_101`, `3cx_outbound_101`, `realtime_agent_connect`, `realtime_outbound_bridge`, `operator_answered` |
| notes | TEXT | | never written. **DEAD** |
| created_at | TEXT | `datetime('now','localtime')` | |
| updated_at | TEXT | `datetime('now','localtime')` | |
| outbound_attempts | INTEGER | 0 | ALTER. Failed callback attempts by operators. |
| last_outbound_time | TEXT | | ALTER |
| last_outbound_operator | TEXT | | ALTER. Mixed formats: `Oybek (101)`, `Operator 101`, plain name. Junk values `'NULL'`, `'null'` and `'\N'` are cleaned at startup. |
| last_outbound_cause | TEXT | | ALTER. Uzbek label: `Mijoz band` (busy), `Javob bermadi` (no answer), `Rad etildi` (rejected), `Aloqa doirasidan tashqarida` (out of reach) |
| resolution_type | TEXT | | ALTER. `operator_outbound`, `client_inbound` or NULL |

- Indexes: `idx_pending_callbacks_phone`, `idx_pending_callbacks_status`, `idx_pending_callbacks_time (call_time DESC)`. Several pending rows per phone are possible; there is no unique constraint.
- Derived UI states:
  - **Kutilmoqda** (waiting): `pending` and `outbound_attempts = 0`.
  - **Ulanilmadi** (unreachable): `pending` and `outbound_attempts > 0`.
  - **Gaplashildi** (talked): `resolved`.
  - Dismissed rows are hidden.
- `source='ivr_non_working'` rows are stored but excluded by every list query (`getCallbacks` base WHERE). They are effectively invisible.

Writers:

- `upsertCallback` from `amiService` in real time (QueueCallerAbandon, trunk hangup without answer) and from `issabelDbService.syncPendingCallbacks` (§3.4 Q8).
  - If a pending row exists, it is updated: count, time, `outbound_attempts` reset to 0 when the call is newer.
  - Otherwise a new row is inserted, but **only if** the call time is later than the last dismissed or resolved record's `call_time` and its close time. Without this check, old calls would reappear.
- `resolveCallback`: sets `status='resolved'`, `dismissed_at=now`, `dismissed_by`, `last_outbound_operator`, `resolution_type`. Matching is `phone = 9-digit OR '998'+9 OR raw OR LIKE %9-digit%`.
- `recordFailedOutboundAttempt`, `dismissCallback` (the id plus all pending rows with the same phone), `dismissAllCallbacks`, `deleteCallbackPermanent` (invalid numbers only).
- Startup DML deletes rows with `phone LIKE '%2020159%'`, `= '712020159'`, length < 7 or length > 12.

Readers: `getCallbacks` / `getPendingCallbacks` (group by phone for pending, by phone and date for resolved; LIMIT 500/300), `getAbandonedBreakdown` (feeds the KPI pro-rating, §3.5), amiService, app.js.

#### 1.1.7 `client_contacts` (dbService). **LIVE, migrate**

| Column | Type | Default | Notes |
|---|---|---|---|
| phone | TEXT | PRIMARY KEY | `cleanContactPhone`: digits only, `998` stripped from 12-digit numbers. Other lengths are kept as-is. |
| name | TEXT NOT NULL | | may be `''` when organization or telegram id is given |
| organization | TEXT | | |
| notes | TEXT | | |
| language | TEXT | `''` | lower-cased free text (e.g. `uz`, `ru`) [?] |
| telegram_user_id | TEXT | `''` | |
| created_at, updated_at | TEXT | `datetime('now','localtime')` | |

- Indexes: `idx_client_contacts_name`, `idx_client_contacts_org`.
- Writer: `saveContact` (UPSERT on phone).
- Delete: `deleteContact` matches the 9-digit and 12-digit variants.
- Readers: `getContact` (tries exact, last 9 digits, then `998`+9), `getAllContacts`, `searchContacts`, `getTopClients`, amiService (caller name enrichment).

#### 1.1.8 `auth_users` (authService). **migrate, preserve hashes**

| Column | Type | Default / constraint | Notes |
|---|---|---|---|
| id | INTEGER PK AUTOINCREMENT | | referenced by `auth_passkeys.user_id` and `auth_password_resets.user_id` |
| username | TEXT | UNIQUE NOT NULL | case-sensitive (BINARY collation). `createUser` enforces 3–32 chars `[a-zA-Z0-9_.-]`; bootstrap and scripts bypass this. |
| password_hash | TEXT NOT NULL | | 128 lower-case hex chars (§1.3) |
| salt | TEXT NOT NULL | | 32 lower-case hex chars (§1.3) |
| role | TEXT | `'superuser'` | `superuser`, `admin` or `operator`. The DB default is `superuser`; the app default is `operator`. |
| operator_id | TEXT | | ALTER. Extension (100–199 HQ operators; 200–209 "Zangiota" accounts created by `scripts/create_200.js`). |
| created_at, updated_at | TEXT | `datetime('now','localtime')` | |
| email | TEXT | | ALTER. Lower-cased. **Not unique in the DB**; uniqueness is checked only in the email-bind flow, so duplicates are possible [?]. |
| webauthn_user_id | TEXT | | ALTER (webauthnService). UUID v4 string, backfilled for every user at startup. |

- Indexes: `idx_auth_users_username`, `idx_auth_users_operator_id`, `idx_auth_users_email`, **UNIQUE** `idx_users_webauthn_uid (webauthn_user_id)`.
- Writers: `ensureBootstrapSuperuser` (only when no superuser exists; password from `DEFAULT_ADMIN_PASSWORD` if ≥12 chars, else random and printed once), `createUser`, `updateUserEmail`, `updateUserOperatorId`, `updateUserPassword`, `updateUserRole` (keeps at least one superuser), `deleteUser` (also deletes sessions and lockout row; passkeys cascade), the email verify/unlink flow, the password-reset flow (which may auto-assign `ADMIN_EMAIL` to a superuser), and scripts `create_200.js` and `promote_maxmudbek.js`.
- Readers: login, session validation (JOIN), WebAuthn, user management.
- Security note: `scripts/create_200.js` sets one shared hard-coded password for `operator200`…`operator209`. Force a reset of those accounts at cutover.

#### 1.1.9 `auth_sessions` (authService + webauthnService). **optional migrate**

| Column | Type | Default | Notes |
|---|---|---|---|
| token | TEXT | PRIMARY KEY | 32 random bytes as hex (64 chars). **Stored in plaintext.** It is the `cc_session` cookie value or a Bearer token. |
| username | TEXT NOT NULL | | joins to `auth_users.username` (no FK) |
| ip | TEXT | | password login: `resolveClientIp` (trusted-proxy XFF). Passkey login: `req.ip` (may be `::ffff:` form). |
| user_agent | TEXT | | truncated to 255 |
| created_at | TEXT | `datetime('now','localtime')` | |
| expires_at | TEXT NOT NULL | | ISO UTC. Password login +7 days; passkey login +30 days. |
| passkey_id | TEXT | | ALTER. `auth_passkeys.id` when created by passkey login |

- Indexes: `idx_auth_sessions_token`, `idx_auth_sessions_expires`, `idx_sessions_passkey`.
- Validation is `JOIN auth_users … WHERE token=? AND expires_at > nowISO`, so a session dies when its user is deleted.
- Deleted when: password changes (all sessions, or all except the current one when the user changes their own password), user is deleted, passkey is deleted (its sessions), on logout or terminate, and expired sessions are purged inside `listActiveSessions`.

#### 1.1.10 `auth_lockouts` (authService). **drop data**

| Column | Type | Default | Notes |
|---|---|---|---|
| key | TEXT | PRIMARY KEY | **an IP address or a username** (mixed namespace; IP detected by `.` or `:`) |
| failed_count | INTEGER | 0 | |
| locked_until | TEXT | | ISO UTC or NULL |
| last_attempt | TEXT | `datetime('now','localtime')` | always overwritten with ISO UTC |

- Index: `idx_auth_lockouts_key` (redundant with the primary key).
- Thresholds come from `system_settings`: `auth_lockout_threshold` (clamped 3–10, default 5) and `auth_lockout_duration_min` (≥ 1, default 60).
- A wrong password increments both the IP and the username keys. An unknown user increments the IP only.

#### 1.1.11 `system_settings` (authService). **migrate**

| Column | Type | Default |
|---|---|---|
| key | TEXT PRIMARY KEY | |
| value | TEXT | |
| updated_at | TEXT | `datetime('now','localtime')` |

| Key | Value format | Seeded | Read by |
|---|---|---|---|
| `auth_lockout_threshold` | integer string | `'5'` | authService |
| `auth_lockout_duration_min` | integer string | `'60'` | authService |
| `excluded_operators` | JSON array of extension strings | `'[]'` | authService, issabelDbService (`EXCLUDED_OPERATORS`), exportService |

The settings are written by `PUT` endpoints in `app.js:755-756` and by `setExcludedOperators`.

The exclusion list is **not** applied everywhere. `dbService.EXCLUDED_OPERATORS` and `syncService.EXCLUDED_OPERATORS` are separate empty Sets that are never filled.

This SQLite table is different from the JSON file `system_settings.json` (§2).

#### 1.1.12 `auth_password_resets` (authService). **drop data**

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | |
| user_id | INTEGER NOT NULL | no FK |
| username, email | TEXT NOT NULL | |
| code_hash | TEXT NOT NULL | `sha256(6-digit code)` as hex, unsalted |
| attempts | INTEGER DEFAULT 0 | 3 wrong codes lock the username for the configured duration |
| expires_at | INTEGER NOT NULL | epoch ms. Code valid 120 s; after verification it is reset to +10 min for the reset token. |
| reset_token | TEXT | 32 random bytes as hex, plaintext |
| used | INTEGER DEFAULT 0 | |
| created_at | INTEGER NOT NULL | epoch ms |

Indexes: `idx_auth_password_resets_user (username)`, `idx_auth_password_resets_token (reset_token)`. A completed reset also deletes all passkeys and sessions of the user (`revokePasskeys: true`).

#### 1.1.13 `auth_email_verifications` (authService). **drop data**

Columns: `id`, `username`, `email`, `code_hash` (sha256 hex), `attempts` (3 maximum), `expires_at` (epoch ms, +120 s), `used`, `created_at` (epoch ms). Index: `idx_auth_email_verifications_user`.

The flow is two-step. If the account already has an email, a code goes to the **old** address first (`step='unlink_current'`), and only then to the new one (`bind_new`). Requesting a code requires the current password.

#### 1.1.14 `auth_passkeys` (webauthnService). **migrate (§1.4)**

| Column | Type | Default / constraint | Notes |
|---|---|---|---|
| id | TEXT | PRIMARY KEY | credential ID as a **base64url string** (`registrationInfo.credential.id`, @simplewebauthn/server 14.1.0) |
| user_id | INTEGER NOT NULL | FK → auth_users(id) ON DELETE CASCADE | |
| webauthn_user_id | TEXT NOT NULL | | copy of `auth_users.webauthn_user_id` at registration |
| username | TEXT NOT NULL | | snapshot at registration (not updated) |
| operator_id | TEXT | | snapshot (not updated) |
| public_key | BLOB NOT NULL | | COSE-encoded public key bytes (`credential.publicKey` Uint8Array) |
| counter | INTEGER | 0 | signature counter; updated on each login |
| device_type | TEXT | | `singleDevice` or `multiDevice` |
| backed_up | INTEGER | 0 | 0/1 |
| transports | TEXT | | JSON array string, e.g. `["internal","hybrid"]`, or NULL |
| device_name | TEXT NOT NULL | | user label, ≤ 60 chars |
| created_at | TEXT | `datetime('now','localtime')` | |
| last_used_at | TEXT | | server local |

Indexes: `idx_passkeys_uid (user_id)`, `idx_passkeys_wuid (webauthn_user_id)`. A user can have at most 10 passkeys.

#### 1.1.15 `call_transcriptions` (sttService + topicAnalyticsService). **migrate (expensive to regenerate)**

| Column | Type | Default / constraint | Notes |
|---|---|---|---|
| id | INTEGER PK AUTOINCREMENT | | |
| call_key | TEXT | UNIQUE | client-built: `${callerId}_${duration}` or `${callerId}_${duration}_${basename(recFile)}`. **Not the CDR uniqueid.** |
| recording_file | TEXT | | path or basename from `cdr.recordingfile` |
| caller_id | TEXT | | |
| duration_sec | REAL | | |
| transcription | TEXT | | raw Wav2Vec2 output (Uzbek) |
| formatted_transcription | TEXT | | cleaned, Gemini-fixed or manually edited text |
| created_at | DATETIME | `CURRENT_TIMESTAMP` (UTC) | overwritten on every save or edit |
| topic, sub_topic | TEXT | | ALTER by topicAnalyticsService. **Never written.** DEAD |
| confidence | REAL | 0 | ALTER. **Never written.** DEAD |

- Indexes: `idx_transcribe_key (call_key)` (redundant with UNIQUE), `idx_transcribe_rec (recording_file)`.
- Writers: `saveToCache` (UPSERT on call_key), `saveManualTranscription`.
- Readers: `getCached` (fuzzy: call_key exact or prefix, then recording basename LIKE, then caller and duration ±4 s, then the latest row for that caller), `getAllTranscribed`, and topicAnalyticsService (`call_key = calls.id OR caller_id = …`).

#### 1.1.16 `call_topic_analytics` (topicAnalyticsService). **SYNTH, drop**

| Column | Type | Default |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | |
| call_id | TEXT UNIQUE | `calls.id` |
| caller_id | TEXT | |
| call_date | TEXT | |
| call_year, call_month | INTEGER | |
| call_hour | INTEGER | 12 (ALTER as well) |
| duration_sec | INTEGER | 0 |
| operator | TEXT | |
| topic_key | TEXT NOT NULL | `kalit`, `edo`, `ehuquqshunos` or `other` |
| sub_topic | TEXT | |
| confidence | REAL | 0.85 |
| snippet | TEXT | |
| source | TEXT | `'stt'` |
| created_at | DATETIME | CURRENT_TIMESTAMP |

Indexes: `idx_topic_date`, `idx_topic_ym (call_year, call_month)`, `idx_topic_key`.

**Most rows are fabricated.**

- `seedInitialAnalyticsIfEmpty` (`source='classified'`) and the analyse endpoint (`source='stt_keyword_analysis'`) assign topics from a hash of `calls.id` using a fixed 46/33/15/6 % distribution. They insert canned snippets, invent `call_hour` when it is outside 8–20, default `caller_id` to `998901234567` and duration to 60.
- Only rows with `source='stt_transcribed'` come from keyword classification of a real transcript.
- Recompute from `call_transcriptions` in the new system; do not migrate.

#### 1.1.17 `stt_learned_rules` (sttCleanerService). **migrate**

| Column | Type | Default / constraint |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | |
| raw_word | TEXT | UNIQUE COLLATE NOCASE |
| clean_word | TEXT NOT NULL | |
| occurrences | INTEGER | 1 |
| created_at, updated_at | DATETIME | CURRENT_TIMESTAMP (UTC) |

- Index: `idx_learned_raw`.
- Writer: `learnPairs` (word pairs extracted by Gemini; UPSERT increments occurrences).
- Startup DML deletes rows where `length(raw_word)>28`, `raw_word LIKE '%buruzgetmush%'` or `'%to%xson%'`, or `clean_word IN ('96233','91688')`.
- Readers: `loadLearnedRules` (whole-word, case-insensitive replacements, longest first), `getLearnedStats`.

#### 1.1.18 `blacklist` (blacklistService). **migrate + reconcile with AstDB**

| Column | Type | Default |
|---|---|---|
| number | TEXT | PRIMARY KEY. Primary form: `998XXXXXXXXX` (12 digits) when the input is 9 or 12 digits, else raw digits. |
| variants | TEXT | JSON array, e.g. `["901234567","998901234567"]` |
| note | TEXT | ≤ 200 chars, `"'\` stripped; `'Asterisk 114'` for rows imported from AstDB |
| created_at, updated_at | DATETIME | CURRENT_TIMESTAMP (UTC) |

- Writers: `add` (UPSERT), `remove`, and `syncFromAsterisk` (on every `getAll`, `INSERT OR IGNORE` from AstDB family `blacklist_114`).
- Despite the generic name, this is a **per-operator block list for extension 114 (Maxmudbek)**: blocked callers are not routed to 114 but still reach other operators (§4). It requires `BLACKLIST_ADMIN_PASSWORD`.

### 1.2 Startup migrations (run on every boot)

| Where | Statement | Notes |
|---|---|---|
| dbService | `ALTER TABLE client_contacts ADD COLUMN language TEXT DEFAULT ''` | try/catch |
| dbService | `ALTER TABLE client_contacts ADD COLUMN telegram_user_id TEXT DEFAULT ''` | |
| dbService | `ALTER TABLE operator_daily_stats ADD COLUMN missed INTEGER DEFAULT 0` | |
| dbService | `ALTER TABLE pending_callbacks ADD COLUMN outbound_attempts INTEGER DEFAULT 0` | |
| dbService | `… ADD COLUMN last_outbound_time TEXT` / `last_outbound_operator TEXT` / `last_outbound_cause TEXT` / `resolution_type TEXT` | |
| dbService | `… ADD COLUMN today_attempts INTEGER DEFAULT 1` | no-op on new DBs (already in CREATE) |
| dbService | `UPDATE pending_callbacks SET last_outbound_operator=NULL WHERE … IN ('NULL','null','\N')` | data fix |
| dbService | `DELETE FROM pending_callbacks WHERE phone LIKE '%2020159%' OR phone='712020159' OR LENGTH(phone)<7 OR LENGTH(phone)>12` | data fix |
| authService | `ALTER TABLE auth_users ADD COLUMN operator_id TEXT` (checked via `PRAGMA table_info`), `CREATE INDEX idx_auth_users_operator_id` | |
| authService | `ALTER TABLE auth_users ADD COLUMN email TEXT`, `CREATE INDEX idx_auth_users_email` | |
| authService | bootstrap superuser; seed 3 `system_settings` keys if missing | |
| webauthnService | `PRAGMA foreign_keys=ON`; `ALTER TABLE auth_users ADD COLUMN webauthn_user_id TEXT`; `CREATE UNIQUE INDEX idx_users_webauthn_uid` | |
| webauthnService | `ALTER TABLE auth_sessions ADD COLUMN passkey_id TEXT`; `CREATE INDEX idx_sessions_passkey` | |
| webauthnService | `CREATE TABLE auth_passkeys …`; backfill `webauthn_user_id = randomUUID()` where NULL or `''` | |
| sttService | `ALTER TABLE call_transcriptions ADD COLUMN formatted_transcription TEXT` | |
| topicAnalyticsService | `ALTER TABLE call_transcriptions ADD COLUMN topic TEXT` / `sub_topic TEXT` / `confidence REAL DEFAULT 0` | dead columns |
| topicAnalyticsService | `ALTER TABLE call_topic_analytics ADD COLUMN call_hour INTEGER DEFAULT 12`; seed synthetic rows if empty | |
| sttCleanerService | `DELETE FROM stt_learned_rules WHERE …` (bad rules) | data fix |

### 1.3 Password hashing (exact; required to migrate without resets)

| Item | Value |
|---|---|
| Algorithm | scrypt via Node `crypto.scryptSync(password, salt, 64)` (`authService.hashPassword`) |
| Parameters | Node defaults: **N = 16384 (2^14), r = 8, p = 1**, maxmem 32 MiB. Key length **64 bytes**. |
| Salt generation | `crypto.randomBytes(16).toString('hex')` gives a 32-char lower-case hex string, stored in `auth_users.salt` |
| **Salt bytes actually used** | The salt is passed as a JS **string**, so scrypt receives the **UTF-8/ASCII bytes of the 32-char hex text** (32 bytes), *not* the 16 decoded bytes. A verifier must reproduce this. |
| Password bytes | UTF-8 of the JS string |
| Output encoding | `.toString('hex')`: 128 lower-case hex chars in `auth_users.password_hash` |
| Comparison | `crypto.timingSafeEqual(Buffer.from(computedHex,'hex'), Buffer.from(storedHex,'hex'))` |
| Trimming quirk | `createUser`, `updateUserPassword` and `completePasswordReset` **trim** the password before hashing. `login` and `verifyUserPassword` do **not** trim. A password set with leading or trailing whitespace can therefore never log in. The new verifier should try the raw input (legacy-equivalent) only. |
| Username lookup | `login` is case-sensitive (`username = ?`); password reset matches case-insensitively by username or email |

Migration approach: store the hash as `scrypt$16384$8$1$<saltHexString>$<hashHex>` with a `password_algo='scrypt-legacy'` flag. Verify it with Node `crypto.scrypt(pw, saltHexString /* as string */, 64)`. Rehash to argon2id on the first successful login.

If converting to PHC `$scrypt$ln=14,r=8,p=1$<salt>$<hash>`, the salt field must be base64 of the **ASCII bytes of the hex string**.

### 1.4 WebAuthn / passkey storage (migratable as-is)

- Library: `@simplewebauthn/server` 14.1.0.
- Registration options: `attestationType:'none'`, `residentKey:'required'`, `userVerification:'required'`.
- Login uses discoverable credentials (`allowCredentials: []`).
- **RP ID** = `WEBAUTHN_RP_ID`, origins = `WEBAUTHN_ORIGINS` (comma list). Existing passkeys are bound to the RP ID. **The new deployment must keep the same RP ID (domain)** or every passkey breaks.
- **User handle**: `userID = isoUint8Array.fromUTF8String(webauthn_user_id)`. The handle bytes are the UTF-8 of the 36-char UUID **string**, not 16 raw UUID bytes.
  - At login, `base64url-decode(response.userHandle)` is UTF-8-decoded and must equal both `auth_passkeys.webauthn_user_id` and `auth_users.webauthn_user_id`.
  - Postgres `uuid` is safe to store this in, because it renders the same lower-case canonical string. The handle must still be encoded from the string form.
- **Credential lookup** is by `body.id` (base64url) = `auth_passkeys.id`.
- **Verification input**: `{ id, publicKey: new Uint8Array(public_key BLOB), counter, transports: JSON.parse(transports) }`. After success, `counter = newCounter` and `last_used_at = now`.
- `username`, `operator_id` and `webauthn_user_id` on the passkey row are denormalised snapshots and can be derived from `user_id`.
- Challenges live in an in-process Map (2 min TTL, single-use) and are not persisted.
- Rate limiters are also in memory.
- Passkey login creates an `auth_sessions` row with `passkey_id` and 30-day expiry. The cookie is `cc_session` (main app); the viewer rewrites it to and from `cc_viewer_session`.
- Deleting a passkey deletes the sessions opened with it.
- Passkeys are revoked (all of the user's) in three cases:
  - Email-code password reset (always).
  - Superuser password reset `PUT /api/settings/users/:u/password` (by default; skipped only if `revokePasskeys:false` is sent).
  - Self-service password change, only when the user ticks `revokeOtherPasskeys`.

### 1.5 Dead / suspicious SQLite items (summary)

| Item | Status |
|---|---|
| `calls` | written; read only by SYNTH topic analytics. Drop. |
| `operator_daily_stats` | DEAD-W. Drop. |
| `operator_reject_events`, `operator_missed_events` | DEAD-R (no writers). They make "denied" always 0. Drop after checking prod row counts [?]. |
| `call_topic_analytics` | SYNTH. Drop. |
| `call_transcriptions.topic/sub_topic/confidence` | never written. Drop. |
| `pending_callbacks.caller_name/notes` | never written. Drop. |
| `pending_callbacks` rows with `source='ivr_non_working'` | stored, never displayed |
| `dbService.getTodaySummary/getHourlyStats/getCallsPaginated` | unused code |

---

## 2. File-based stores

### 2.1 JSON files: main app (`legacy/`)

| Path | Shape | Writer | Reader | Lifecycle | Cutover |
|---|---|---|---|---|---|
| `system_settings.json` (**repo root, not `data/`**) | `{ autoRecoverVms: bool, updatedAt: ISO, lastRecovery: { startTime, endTime: ISO, durationSec, status: 'success'\|…, trigger: 'auto'\|'manual', stoppedVms: string[], output: string (multi-line log), error: string\|null, vms: [{id:number, name, desc, status}] } }` | `proxmoxService.saveRecoveryHistory` / `setAutoRecover` | proxmoxService | overwritten per recovery | migrate `autoRecoverVms` → settings; `lastRecovery` optional |
| `data/queue-sync-settings.json` | `{ enabled: bool, mode: 'grandTotal', updatedAt: ISO }` | `amiService.saveQueueDbSyncSettings` | amiService (default `true` when missing) | toggled by admin | migrate as a setting |
| `data/calls-taken-overrides.json` | `{ "<ext>": <int offset> }`, a manual display offset added to queue `callsTaken` | amiService (adjust/reset/sync-from-DB) | amiService | cleared at Tashkent midnight | drop |
| `data/active_channels_state.json` | `{ timestamp: ms, channels: [{channel, callerId, callerName, extension, context, application, state, direction, duration, startTime, answeredTime, dialedPhone, operator, pairedChannel}], outboundCalls: [{opId, dialedNumber, targetPhone, channel, destChannel, startTime, answeredTime?}] }` | amiService (debounced 1 s; on SIGINT and SIGTERM) | amiService on boot, **ignored if mtime is more than 5 min old** | restart cache | drop |
| `data/voice_identifications.json` | array of `{ file, uniqueid, caller_id, calldate, duration, speaker: 'zuhra'\|'muattar', speaker_name, score, zuhra_segments, confidence (0–100), top_segments: [] (≤3, shape [?]), is_manual_override?, updated_at?, is_verified?, verified_at? }` plus extra fields from the orchestrator [?] | `voicePrintService` (`updateSpeaker`, `toggleVerified`, `addOrUpdate`, initial import from `scratch/batch_scan_report.json`), `POST /api/internal/voice-scan-sync` (skips entries with `is_manual_override`) | voicePrintService (mtime-based reload; indexed by file, basename, uniqueid, `caller_date`), voiceSnowballService | grows | migrate if the voice-ID feature is kept. Manual overrides and verification are human work. |
| `data/voice_candidate_samples.json` | array of `{ id: 'sample_N', file, filename, url, audio_url: '/samples/candidates/<wav>', caller_id, calldate, source_call, start_sec, end_sec, time_range, duration_sec, similarity_score, source_type: 'manual_override'\|'ai_detected', batch: number, description, status: 'pending'\|'approved'\|'denied', reviewed_at: ISO\|null }` | voiceSnowballService, `POST /api/voice-samples/review` | app.js, voiceSnowballService | grows | migrate with the WAVs in `public/samples/candidates/` if the feature is kept |
| `data/oybek_samples.json` | same shape as above [?] | external `scripts/generate_oybek_snowball.py` (**not in repo**); review endpoint | app.js | | same |
| `data/dual_speaker_results.json` | array, shape unknown [?] | external Python (not in repo) | `GET /api/voice-scan/dual-speaker-results` | | optional archive |
| `data/voice_scan_status.json` | `{ totalTarget, scannedCount, remainingCount, percent: 'NN%', zuhraCount, muattarCount, isRescan, previousZuhraCount, newlyFoundZuhraCount, newlyFoundZuhraList: [], speedPerMin, etaMinutes, estimatedEndTime, currentTask: {stage, stagePercent, currentIndex, totalCandidates}, lastScanned: {file, caller_id, calldate, speaker} }` | `/api/internal/voice-scan-sync`, `/api/voice-scan/restart`, `/api/voice-identification/switch`; orchestrator `scripts/voice_scan_orchestrator.js` (**not in repo**) | app.js, telegramService | transient progress. Scan window hard-coded `2026-08-17`–`2026-09-19`, default target 558. | drop |
| `data/telegram_subscribers.json` | array of `{ chatId: string, username, firstName, lastName, subscribedAt: ISO }` | `telegramService.addSubscriber` (on bot `/start` [?]) | telegramService (broadcast) | grows | **migrate** |
| `data/stt_custom_rules.json` | array of `{ pattern: string (RegExp source, applied with flags 'gi'), replace: string }` | `sttCleanerService.addCustomRule` | sttCleanerService (applied first) | grows | migrate |
| `data/tree.json` (also `viewer/public/data/tree.json`) | recursive `[{ id, title, hint, url?, children?: [...] }]`, a knowledge-base link tree (EDO, OneID, …) | hand-edited | viewer front-end `fetch('/data/tree.json')` | static content | move to front-end assets, not the DB |
| `data/.internal_token` | 64-hex secret (mode 0600) for `x-internal-token` service-to-service calls | app.js (generated if `INTERNAL_API_TOKEN` is unset) | app.js, viewer | | replace with an env secret |
| `scratch/ui_inbox.json` | array (≤50) of `{ id: ms, createdAt, element, elements, count, task, prompt, images: [{name, fileName, remotePath, size, base64}], hasImages, status }` | `POST` visual-prompt dev tool | `scripts/watch_ui_inbox.js` | dev tooling | drop |
| `scratch/batch_scan_report.json` | voice scan raw report (`file, src, calldate, billsec, is_zuhra_detected, zuhra_match_count, max_zuhra_score, top_segments`) | external | voicePrintService one-time import | | drop |

### 2.2 JSON files: viewer (`legacy/viewer/data/`)

| Path | Shape | Writer / reader | Cutover |
|---|---|---|---|
| `viewer/data/tickets.json` | Current format: `{ lastCleanedMonday: 'YYYY-MM-DD'\|null, updatedAt: ms, total, tickets: Ticket[] }`. Older format: a bare `Ticket[]`, also accepted. | `viewer/services/ticketService.js` (all CRUD) | **migrate** (see below) |
| `viewer/data/viewer_history.json` | array (last 500) of `{ id: 'vh_<ms>_<rand4>', ip, username ('Admin'/'Mehmon' fallbacks), role, operatorId, operatorName, connectedAt: ms, disconnectedAt: ms\|null, durationSeconds, status: 'online'\|'offline', userAgent }` | viewer `app.js` on WS connect and disconnect; on boot, stale `online` entries become `offline` | optional (audit trail) |
| `viewer/data/rustdesk_devices.json` | array of `{ ext: string\|null, ip: string\|null, hostname, installed: bool, updatedAt: ISO }`, deduplicated by ext, else by ip | `POST /api/remote-desktop/report-installed` / `GET /api/remote-desktop/devices` | migrate (small) |

**Ticket** fields:

- `id`: `'TK-<n>'`, next = max + 1, starting at `TK-1001`.
- `creatorId`, `creatorName`, `creatorIp`.
- `customerPhone`: string or null.
- `title`: first 40 chars of `comment` + `'...'`.
- `comment`.
- `files`: `Attachment[]`.
- `isUrgent`.
- `targetOperatorId`: `'all'` or an extension. `targetOperatorName`.
- `status`: `pending`, `in_progress`, `completed` or `rejected`.
- `acceptedBy`, `completedBy`: `{id, name, at: ms}` or null. `rejectedBy`: `{id, name, at, reason}` or null.
- `createdAt`, `updatedAt`: ms.
- `comments`: `[{ id: 'cm_<ms>_<rand4>' | 'cm_<ms>_sys', operatorId, operatorName, text, files: Attachment[], isSystem?, createdAt: ms }]`.

**Attachment** fields: `{ name, fileName: 'tk_<ms>_<rand5>_<safe>.<ext>', url: '/uploads/tickets/<fileName>', size, mimeType, ext, uploadedAt: ms }`. Files are stored in `viewer/public/uploads/tickets/`.

Ticket rules:

- Visibility: operators with extension 200 or above (the Zangiota "creators") see tickets created by any 200+ creator. Operators 100–199 see tickets targeted at `all` or at themselves.
- Only the creator (or `admin`/`superuser`) may edit.
- **Every Monday** (server-local `getDay()===1`, once per day), completed tickets and their files are deleted. A manual "cleanup completed" does the same.

### 2.3 Redis keys (cache only, do not migrate)

| Key | TTL | Content |
|---|---|---|
| `callcenter:summary`, `callcenter:hourly`, `callcenter:operators` | 60 s | live today snapshot from `syncAllData` (5 s loop) |
| `callcenter:hist:operators:<date>` | 7 d | operator stats for past dates |
| `callcenter:hist:full_stats:<date>` | 7 d | full KPI payload for past dates |
| `callcenter:hist:calls:v6:<date>:<page>:<limit>:<search>:<dir>:<status>` | 15 s today / 30 s all / 7 d past | call list page |
| `callcenter:hist:count:v6:<date>:<search>:<dir>:<status>` | 45 s / 60 s / 7 d | call list count |
| `callcenter:hist:detail:<date>:<type>:<op>:<page>:<limit>:<search>` | 7 d (past only) | drill-down page |
| `callcenter:top_clients:<date>:<limit>` | 30 s / 180 s | top callers |

Separately, `issabelDbService` also keeps in-process caches: `cache.{summary,hourly,operators}` and `historicalCache` (5 min).

### 2.4 Other on-disk artefacts

| Path | What | Cutover |
|---|---|---|
| `data/temp_zips/<jobId>.zip` | recording ZIP exports (zipJobService). Jobs live in an in-memory Map; files are deleted after 2 h. | drop |
| `scratch/calls/` | locally cached recordings for STT and voice slicing | drop |
| `scratch/uploads/` | dev-tool images | drop |
| `public/samples/candidates/*.wav` | voice sample slices referenced by `voice_candidate_samples.json` | migrate with that feature |
| `data/zuhra_profile_ensemble.pt` | speaker-embedding model (PyTorch) | keep if the voice-ID feature is kept |
| `viewer/public/uploads/tickets/*` | ticket attachments | **migrate with tickets** |

---

## 3. PBX MariaDB usage

### 3.1 Access, databases, columns

Legacy access path:

- One persistent SSH connection (`SSH_HOST/PORT/USER/PASSWORD`, default `root@192.168.0.124`).
- Each query runs `MYSQL_PWD=… mysql -u <ASTERISK_DB_USER|asteriskuser> -N -B` with the SQL written to stdin.
- Output is tab-separated, with no header. NULL prints as `NULL`; some code also checks for `\N`.
- Several statements are sent per call and split on marker rows (`SELECT '===NAME==='`). The default timeout is 90 s.

Tables and columns read:

| DB.table | Columns read | Not used (available) |
|---|---|---|
| `asteriskcdrdb.cdr` | `calldate, src, dst, dcontext, channel, dstchannel, lastdata, disposition, billsec, duration, uniqueid, recordingfile` | `clid, lastapp, amaflags, accountcode, userfield, did, cnum, cnam, outbound_cnum, dst_cnam, linkedid, sequence, peeraccount` [?] (**`lastapp` is not used anywhere; `lastdata` is**) |
| `asterisk.users` (FreePBX) | `extension, name` | |
| `queue_log`, `cel` | **not used** | `queue_log` would give exact queue abandon, ringnoanswer and agent data [?]. In Issabel it may exist only as a file (`/var/log/asterisk/queue_log`). |

Other PBX reads over SSH, not SQL:

- `find /var/spool/asterisk/monitor/YYYY/MM/DD -type f -name "*<last9digits>*"` (`fetchCallsDetail`, 2.5 s timeout).
- `du -sb <dir>/*` (sftpService).
- SFTP listing of `/var/spool/asterisk/monitor/YYYY/MM/DD/` every 10 s (audioIndexService).
- `asterisk -rx "database show blacklist_114"`.

The new stack needs a MariaDB user with `SELECT` on `asteriskcdrdb.cdr` and `asterisk.users` only, plus network access to port 3306. Issabel MariaDB usually binds to localhost, so either open it to the app host or tunnel [?].

**Check the MariaDB version** with `SELECT VERSION()`. Issabel 4 (CentOS 7) ships MariaDB 5.5, which has no window functions, no CTEs and no JSON functions [?]. That constrains how the "latest value per group" logic below (done with `SUBSTRING_INDEX(GROUP_CONCAT(… ORDER BY calldate DESC SEPARATOR '|||'),'|||',1)`) can be rewritten.

### 3.2 Magic constants and conventions

| Constant | Meaning / where |
|---|---|
| `712020159` | SIP trunk peer name: inbound calls arrive on channel `SIP/712020159-xxxxxxxx` (`channel LIKE 'SIP/712020159%'`). Also excluded as a "phone". |
| `2020159` | DID / queue number (`q-2020159-…` recording prefix suggests the queue extension [?]). Excluded wherever it appears: `dst/dstchannel/src/phone LIKE '%2020159%'`, `endsWith('2020159')`. |
| `ext-queues` | FreePBX queue context: a call entering the queue |
| `from-trunk` | inbound DID routing context |
| `ivr-4` | the IVR menu used for inbound (IVR id 4) |
| `from-internal` | calls originated by internal extensions (outbound to PSTN and internal) |
| `from-internal-xfer` | legs created by call transfers (used to build transfer chains) |
| `from-queue` | queue member dial context. Members are `Local/<ext>@from-queue/n`. Answered queue legs show `dstchannel LIKE 'Local/<ext>@from-queue…'`. |
| `app-%` contexts, `dst IN ('s','h','t','i','e')`, `dst LIKE '*%'` | system / feature-code rows, excluded from per-operator drill-down |
| `lastdata REGEXP 'working-time\|music-working-time'` | the IVR played the "outside working hours" announcement. Marks off-hours callers (`ivr_non_working`) [?] (announcement names). |
| Operator extension regex | `^[0-9]{2,4}$` (most queries), `^[0-9]{3,4}$` (historical per-operator inbound, `fetchOperatorNamesDirect`), `^[0-9]+$` (`getExistingAsteriskUsers`), app-side `isExtension` = `^[0-9]{2,6}$` |
| Internal number | `src REGEXP '^[0-9]{1,4}$'`, excluded from inbound (operator-to-operator calls) |
| Client phone | `LENGTH(x) >= 7`; for callbacks `src REGEXP '^[0-9]{7,12}$'`; for top clients `^[0-9]{7,15}$` |
| Working hours | `TIME(calldate) >= '08:00:00' AND TIME(calldate) <= '21:00:00'` (inclusive, so 21:00:00 exactly is in). Hourly charts use `HOUR(calldate) BETWEEN 8 AND 21`, giving 14 buckets 08–21 where bucket 21 holds only the `21:00:00` second. SQLite side uses `time(event_time)` and `isWorkingHours` (480 ≤ minutes ≤ 1260). |
| "Today" | Live loop uses `calldate >= CURDATE()` (**PBX DB clock**). Date-parameterised queries use `'<YYYY-MM-DD> 00:00:00' … '23:59:59'` with the date computed in **Asia/Tashkent**. These agree only if the PBX TZ is Asia/Tashkent [?]. |
| Date param forms | `YYYY-MM-DD`, `YYYY-MM-DD_YYYY-MM-DD` (range), `all` / `all_time` (no filter; top clients and xfer subqueries cap at 30 days) |
| Operator names | `asterisk.users.name` overrides the hard-coded map `{101:'Oybek',103:'Feruza',106:'Ubaydullayeva Gulchehra',111:'Nozima',114:'Maxmudbek',119:'Muattar',120:'Navruzoy'}` (duplicated in 3 files). **Extension 114 is always forced to `Maxmudbek`.** In the webauthn UI, extensions starting with `2` are labelled "Zangiota". |
| Ext 119 is shared | "Muattar" and "Zuhra opa" use ext 119. The voice-ID feature tells them apart; the recordings speaker filter `muattar\|zuhra` maps to search `119`. |
| Phone normalisation | `dbService.normalizePhone`: strip non-digits; 12-digit `998…` becomes 9 digits; reject lengths below 7 or above 12 and trunk numbers. Search variants: `x`, 9↔`998`+9, `+998…`, `0`+last9, `9`+last9 (dial prefixes). Blacklist: 10-digit `8…` drops the 8; primary = `998`+9. |
| Recording filenames | `q-<queue>-<cid>-<YYYYMMDD>-<HHMMSS>-<uniqueid>.wav`, `external\|out\|in-<ext>-<num>-<YYYYMMDD>-<HHMMSS>-<uniqueid>.wav`, `g<ext>-<YYYYMMDD>-<HHMMSS>-<uniqueid>.wav`, stored under `/var/spool/asterisk/monitor/YYYY/MM/DD/`. Duration is estimated as `(size-44)/16000` (8 kHz 16-bit mono). |

### 3.3 Reusable predicates (the building blocks)

Write these once as Kysely helpers. Every legacy query combines them.

| Name | SQL (legacy, verbatim logic) | Meaning |
|---|---|---|
| **P_INBOUND** | `(dcontext IN ('ext-queues','from-trunk','ivr-4') OR channel LIKE 'SIP/712020159%') AND channel NOT LIKE 'Local/%' AND (dcontext IS NULL OR dcontext <> 'from-internal') AND (src IS NULL OR src NOT REGEXP '^[0-9]{1,4}$')` | a row belonging to an external inbound call |
| **P_INBOUND_LOOSE** | the first clause only (`dcontext IN (…) OR channel LIKE 'SIP/712020159%'`) | used by `answered` drill-down, top clients, recordings `direction=inbound`, call-list `direction=inbound` |
| **P_OP_ANSWERED** (row) | `disposition='ANSWERED' AND billsec>0 AND (dst REGEXP '^[0-9]{2,4}$' OR dstchannel LIKE 'Local/%@from-queue%' OR (dstchannel LIKE 'SIP/%' AND dstchannel NOT LIKE '%2020159%'))` | a leg where an **operator** (not the IVR or queue) talked |
| **S_OP_ANSWERED_UIDS** | `SELECT [DISTINCT] uniqueid[, MAX(billsec) talk_sec] FROM cdr WHERE <date> AND P_OP_ANSWERED [GROUP BY uniqueid]` | the uniqueids answered by an operator. An inbound uniqueid is "answered" if it is in this set. |
| **P_OUTBOUND** | `dcontext='from-internal' AND channel REGEXP '^SIP/[0-9]{2,4}-' AND LENGTH(dst) >= 7` | operator dialled an external number |
| **P_ANSWERED** | `disposition='ANSWERED' AND billsec>0` | answered with talk time. `disposition='ANSWERED'` alone is not trusted, because the IVR or queue answers inbound legs. |
| **P_XFER** | `dcontext='from-internal-xfer' AND disposition='ANSWERED' AND billsec>0` | an answered transfer leg |
| **P_WORKHOURS** | `TIME(calldate) BETWEEN '08:00:00' AND '21:00:00'` | |
| **E_EXT_FROM_SIP_CHANNEL** | `SUBSTRING_INDEX(SUBSTRING_INDEX(channel,'/',-1),'-',1)` or `SUBSTRING_INDEX(SUBSTRING_INDEX(channel,'-',1),'SIP/',-1)` | `SIP/101-0000abcd` → `101` |
| **E_EXT_FROM_LOCAL** | `SUBSTRING_INDEX(SUBSTRING_INDEX(x,'@',1),'/',-1)` | `Local/101@from-queue-…;1` → `101` |
| **E_OP_EXT_CALL** (call list) | `MAX(CASE WHEN channel REGEXP '^SIP/[0-9]{2,4}-' THEN ext(channel) WHEN src REGEXP '^[0-9]{2,4}$' THEN src WHEN P_ANSWERED AND dstchannel LIKE 'Local/%@%' THEN localExt(dstchannel) WHEN P_ANSWERED AND channel LIKE 'Local/%@%' THEN localExt(channel) WHEN P_ANSWERED AND dstchannel LIKE 'SIP/%' THEN ext(dstchannel) WHEN P_ANSWERED AND dst REGEXP '^[0-9]{2,4}$' THEN dst WHEN dst REGEXP '^[0-9]{2,4}$' THEN dst WHEN dstchannel LIKE 'SIP/%' THEN ext(dstchannel) ELSE '' END)` grouped by uniqueid | the operator of a call. Note that `MAX()` over strings picks the lexicographically largest candidate across legs, not the first match. |
| **E_OP_EXT_CB** (callbacks) | latest by calldate of `CASE WHEN LENGTH(src)>=7 AND dst REGEXP '^[0-9]{2,4}$' THEN dst WHEN dcontext<>'from-internal' AND dstchannel LIKE 'Local/%@from-queue%' THEN localExt(dstchannel) WHEN dstchannel REGEXP '^SIP/[0-9]{2,4}-' THEN ext(dstchannel) WHEN dcontext='from-internal' AND channel REGEXP '^SIP/[0-9]{2,4}-' THEN ext(channel) WHEN dcontext='from-internal' AND src REGEXP '^[0-9]{2,4}$' THEN src END` | |
| **E_CLIENT_PHONE** | `CASE WHEN LENGTH(src)>=7 AND (LENGTH(dst)<7 OR dst REGEXP '^[0-9]{2,4}$') THEN src WHEN LENGTH(dst)>=7 THEN dst ELSE src END` | the external party of a row |
| **E_DIRECTION_ROW** | `CASE WHEN dcontext='from-internal' AND LENGTH(dst)>=7 THEN 'outbound' ELSE 'inbound' END` | |
| **J_XFER** | `LEFT JOIN (SELECT uniqueid, SUBSTRING_INDEX(channel,';',1) xfer_key, localExt(MIN(channel)) xfer_from, GROUP_CONCAT(DISTINCT dst ORDER BY calldate SEPARATOR ' ➔ ') xfer_chain FROM cdr WHERE <date or last 30d> AND dcontext='from-internal-xfer' AND dst REGEXP '^[0-9]{2,4}$' GROUP BY uniqueid) xfer ON c.uniqueid=xfer.uniqueid OR (xfer.xfer_key<>'' AND (SUBSTRING_INDEX(c.channel,';',1)=xfer.xfer_key OR SUBSTRING_INDEX(c.dstchannel,';',1)=xfer.xfer_key))` | attaches the transfer chain to a call. The OR-join is non-sargable; rewrite it as two lookups in app code. |

### 3.4 Query catalogue (`issabelDbService` + `syncService`)

All CDR queries run against `asteriskcdrdb.cdr`. `<D>` is the date condition from `getDateCondition`.

**Q1 `getExistingAsteriskUsers`** (`GET /api/settings/exclude-list`)
- `SELECT extension, name FROM asterisk.users WHERE extension REGEXP '^[0-9]+$' ORDER BY CAST(extension AS UNSIGNED)`.
- Empty names become `Operator <ext>`; 114 becomes `Maxmudbek`. Updates the in-memory name map.

**Q2 `syncAllData`** (every 5 s; feeds the live dashboard, `amiService` and Redis). One multi-statement script for "today", using `calldate >= CURDATE()` and P_WORKHOURS throughout:

| Section | Query | Interpretation |
|---|---|---|
| USERS | `asterisk.users` where extension `^[0-9]{2,4}$` | name map |
| SUMMARY_IN | `FROM cdr c LEFT JOIN S_OP_ANSWERED_UIDS(today, with MAX(billsec) talk_sec) op USING uniqueid WHERE today AND P_WORKHOURS AND P_INBOUND`. Selects `COUNT(DISTINCT c.uniqueid)` total_inbound, `COUNT(DISTINCT … op.uniqueid NOT NULL)` ans_inbound, `SUM(DISTINCT op.talk_sec)` in_talk_sec, `SUM(disposition='FAILED')` den_inbound, `COUNT(DISTINCT src)` unique_clients, `COUNT(DISTINCT src where answered)` ans_unique_clients. | inboundCalls, answeredCalls, abandoned = total − answered. **Bug:** `SUM(DISTINCT talk_sec)` collapses equal durations. `den_inbound` is computed but unused. |
| SUMMARY_OUT | `WHERE today AND P_WORKHOURS AND P_OUTBOUND`: `SUM(P_ANSWERED)` (twice), `SUM(billsec where ANSWERED)`, `COUNT(DISTINCT dst where P_ANSWERED)` | **outboundCalls = answered outbound only.** Unanswered dials are never counted. |
| HOURLY | as SUMMARY_IN, plus `HOUR BETWEEN 8 AND 21 GROUP BY HOUR(calldate)`: distinct uids, distinct answered uids | 14 buckets `08:00`…`21:00` |
| OPERATORS | `WHERE today AND P_WORKHOURS AND dst REGEXP '^[0-9]{2,4}$' AND src not internal GROUP BY dst`: `SUM(P_ANSWERED)`, `SUM(billsec where ANSWERED)` | raw inbound answered per extension. **Includes transfer receipt legs** (dst = target). |
| OP_OUTBOUND | `P_OUTBOUND … GROUP BY E_EXT_FROM_SIP_CHANNEL`: answered count, duration | outbound per operator |
| XFER_ROWS | `P_XFER … ORDER BY channel, calldate`: `from_op` (Local/ or SIP/ ext of `channel`), `to_op = dst`, `channel` | transfer chains, grouped **by identical `channel` string** |

Operator metrics are then computed in JS (§3.5).

**Q3 `fetchOperatorStats(date)`** (`/api/operators` history, exports, agent stats endpoint). Same structure as Q2's OPERATORS, OP_OUTBOUND and XFER_ROWS for date `<D>`, with these differences:
- Inbound uses `dst REGEXP '^[0-9]{3,4}$'` (not 2–4).
- It also returns `COUNT(*) total_offered` (unused).
- Outbound returns `COUNT(*)` total attempts (unused).
- `missed` comes from SQLite and is added; `grandTotal` is added.
- Operators from the name map with no CDR rows are also emitted with zeros.
- Cached in Redis for 7 days for past dates.

**Q4 `fetchHourlyStats(date)`** (only reached through `fetchTodayHourlyStats`, as today's fallback before the Q2 cache is warm; no caller passes a past date). `WHERE <D> AND P_WORKHOURS AND P_INBOUND AND HOUR BETWEEN 8 AND 21 GROUP BY HOUR`: `COUNT(DISTINCT uniqueid)`, `SUM(disposition='ANSWERED' AND billsec>0)`. **Inconsistent with Q2:** answered counts raw rows, not distinct operator-answered uniqueids, so IVR-answered legs are counted.

**Q5 `fetchSummaryByDate(date)`** (`GET /api/db/summary`). SUMMARY_IN and SUMMARY_OUT as in Q2 for `<D>`, but **without the 08:00–21:00 filter** (inconsistent with Q2 and Q6).

**Q6 `fetchFullStatsByDate(date)`** (`GET /api/stats?date=`). SUMMARY_IN, SUMMARY_OUT and HOURLY exactly as in Q2 but for `<D>`. Adds SQLite rejects and missed. Cached in Redis for 7 days for past dates.

**Q7 `fetchCallsPaginated(page, limit, search, date, direction, status)`** (call history; also polled by amiService every 15 s for page 1).
- Filter: `<D> AND P_WORKHOURS AND (P_INBOUND_LOOSE OR (dcontext='from-internal' AND channel REGEXP '^SIP/[0-9]{2,4}-')) AND channel NOT LIKE 'Local/%'`, plus the search condition (§3.6).
- `direction=transfer`: `xfer_chain` present. `outbound`: from-internal SIP ext and no chain. `inbound`: P_INBOUND_LOOSE and no chain.
- `status=answered`: P_ANSWERED (row-level). `missed`: NOT P_ANSWERED (row-level, so an answered call with an unanswered leg still matches).
- Count: `COUNT(DISTINCT c.uniqueid)` (joins J_XFER only when needed). Today without filters reuses `summary.totalCalls`.
- Data: `GROUP BY c.uniqueid ORDER BY MIN(calldate) DESC LIMIT/OFFSET` returning:
  - `uniqueid`, `call_time = MIN(calldate)`, `MIN(src)`, `MIN(dst)`
  - `op_ext = E_OP_EXT_CALL`
  - `final_disp`: `ANSWERED` if any P_ANSWERED, else `BUSY` if any BUSY, else `DENIED` if any FAILED, else `ABANDONED`
  - `talk_sec = MAX(billsec)`, `wait_sec = MAX(duration)`
  - `ans_lag_sec = TIMESTAMPDIFF(SECOND, MIN(calldate), MAX(calldate where P_ANSWERED))`
  - `rec = MAX(recordingfile)`
  - `is_out = MAX(from-internal and SIP ext channel)`
  - `xfer_from`, `xfer_chain`
- Interpretation in JS: see §3.5.

**Q8 `syncPendingCallbacks(days, activePhones)`** (amiService every 15 s: `days=30` every 30 min, else `days=2`; also `POST /api/callbacks/sync`). It has three phases:

1. **Re-check current pending rows** (lookback `CURDATE() − 3 days`).
   - (a) Answered contacts per phone: `GROUP BY E_CLIENT_PHONE` over `P_ANSWERED AND (LENGTH(src)>=7 AND src NOT LIKE '%2020159%' OR LENGTH(dst)>=7 AND dst NOT LIKE '%2020159%')`, returning `MAX(calldate)`, E_DIRECTION_ROW and E_OP_EXT_CB. Rows without an operator ext are ignored (IVR, blackhole or queue robot answers).
   - (b) Failed outbound per phone: `dcontext='from-internal' AND LENGTH(dst)>=7 AND dst NOT LIKE '%2020159%' AND (disposition<>'ANSWERED' OR billsec=0) GROUP BY phone`, returning last time, latest `src` (operator), latest `disposition`, `COUNT(*)`.
   - For each pending row: if (a) is at or after `call_time`, call `resolveCallback` (`resolution_type` is `operator_outbound` or `client_inbound`). Else if (b) is at or after `call_time`, call `recordFailedOutboundAttempt` (cause = last disposition, attempts = count).
2. **Find unanswered inbound calls** (lookback `days`, **no working-hours filter**).
   - Inner query: per `channel` (`GROUP BY c.channel`) from rows with `P_INBOUND`, `src REGEXP '^[0-9]{7,12}$'`, `src NOT LIKE '%2020159%'`, `op_ans.uniqueid IS NULL` (no operator-answered leg with the same uniqueid; S_OP_ANSWERED_UIDS over `days`) and `op_chan.channel IS NULL` (no `P_ANSWERED` row on the same channel).
   - Outer query: `GROUP BY src`, returning `callback_time = MAX(per-channel MIN(calldate))`, `total_attempts = COUNT(DISTINCT channel)`, `today_attempts = COUNT(DISTINCT channel today)`, and `source_type`.
   - `source_type = 'ivr_non_working'` if the latest non-from-internal row's `"TIME|||lastdata"` matches `working-time|music-working-time`, or its time is before 08:00 or after 21:00. Otherwise `'abandoned'`.
   - `ORDER BY callback_time DESC LIMIT 250`.
   - The answered-per-phone query (a) is rerun over `days`. If the phone was answered by an operator after `callback_time`, call `resolveCallback`. Else skip if the phone is currently in a live call (AMI), and otherwise call `upsertCallback(phone, source_type, callback_time, total_attempts, today_attempts)`.
3. **Cleanup**: today's pending rows with invalid phones are hard-deleted. Rows answered later are resolved.

**Q9 `fetchCallsDetail({type, operatorExt, page, limit, search, date})`** (`GET /api/calls/details`, KPI card and operator drill-down). Base filter: `<D> AND P_WORKHOURS`, plus the clause for the type:

| type | Extra filter | Notes |
|---|---|---|
| `all` | `(P_INBOUND_LOOSE AND channel NOT LIKE 'Local/%') OR P_OUTBOUND` | |
| `inbound` | `P_INBOUND` | |
| `outbound` | `P_OUTBOUND AND P_ANSWERED` | |
| `answered` | `P_ANSWERED AND P_INBOUND_LOOSE` | |
| `abandoned` | `P_INBOUND AND op_ans.uniqueid IS NULL` (LEFT JOIN S_OP_ANSWERED_UIDS) | count is computed (not cached) |
| `transferred` | `dcontext='from-internal-xfer' AND disposition='ANSWERED'`, optionally `(dst=ext OR channel LIKE 'Local/ext@%' OR channel LIKE 'SIP/ext-%')` | |
| `operator` + ext | `(dstchannel LIKE 'SIP/ext-%' OR channel LIKE 'SIP/ext-%' OR (src=ext AND dcontext='from-internal') OR (dst=ext AND P_ANSWERED)) AND dst NOT IN ('s','h','t','i','e') AND dcontext NOT LIKE 'app-%' AND dst NOT LIKE '*%'` | |
| `denied` | **SQLite** `operator_reject_events` | always empty (§1.1.3) |
| `missed` | **SQLite** `agent_3cx_call_logs` (missed rule) | |

- Data columns are as in Q7, plus `MAX(dcontext)`, `MAX(lastdata)` and `op_billsec` (MAX billsec on legs touching `operatorExt`).
- When searching, the count is skipped.
- For `operator`, `outbound` and `all` **today**, it merges `agent_3cx_call_logs` rows that have no CDR match (last-9-digit phone match within ±180 s). Their recording is found via the audio index or an SSH `find`.
- Non-operator labels: `IVR (Ish vaqti emas)` when `lastdata` contains `working-time`; `Navbat` (queue) when `dcontext='ext-queues'`, dst contains 2020159, or rec contains `q-2020159`; `Navbatga kirmasdan chiqdi` (left before entering the queue) when the context or lastdata contains `ivr`; `Avtojavob (Tizim)` (system auto-answer) when answered with no operator.

**Q10 `fetchTopClients(limit, date)`** (`GET /api/contacts/top-active`).
- `WHERE <D> (or last 30 d for all) AND P_INBOUND_LOOSE AND src REGEXP '^[0-9]{7,15}$' GROUP BY src ORDER BY COUNT(DISTINCT uniqueid) DESC LIMIT n`.
- Returns `COUNT(DISTINCT uniqueid)`, `SUM(P_ANSWERED)` (rows), `SUM(billsec)`, `MAX(calldate)`.
- Has a 3.5 s timeout; falls back to SQLite `getTopClients`.

**Q11 `countRecordingsByDateRange` / Q12 `fetchRecordingsByDateRange`** (ZIP export of recordings).
- Filter: `calldate BETWEEN s 00:00:00 AND e 23:59:59 AND P_WORKHOURS AND P_ANSWERED AND recordingfile NOT IN (NULL,'','NULL','\N')`, plus search, direction (`outbound` = from-internal SIP ext; `inbound` = P_INBOUND_LOOSE), status and speaker (`zuhra`/`muattar` → search `119`).
- Count returns `COUNT(DISTINCT uniqueid)` and `SUM(billsec)`.
- List: `GROUP BY uniqueid` returning `MIN(calldate)`, `MAX(src/dst/channel/dstchannel)`, `MAX(billsec)`, `MAX(recordingfile)`, is_out; `LIMIT` (default 5000).
- Operator ext: for outbound, `SIP/(\d{2,4})-` from channel, else src. For inbound, `dst` if 2–4 digits, else `SIP/ext-` or `Local/ext@` from dstchannel.
- ZIP entry name: `<calldate with : and space → ->_<clientDigits>[_<OperatorName>].wav`.

**Q13 `syncService.syncDailyCdrToAgentLogs(date)`** (every 15 min and at 21:00 Tashkent; backfills SQLite).
- Inbound: `<date 08:00–21:00> AND dst REGEXP '^[0-9]{2,4}$' AND dcontext <> 'from-internal-xfer' AND P_ANSWERED`, returning `calldate, src, dst, disposition, billsec`. Inserted as `ANSWERED` for operator `dst`.
- Outbound: `<date 08:00–21:00> AND dcontext='from-internal' AND channel REGEXP '^SIP/[0-9]{2,4}-' AND (dstchannel LIKE 'SIP/%' OR LENGTH(dst)>=7) AND P_ANSWERED`, returning `calldate, src, dst, op_id, disposition, billsec`. Inserted as `DIALLED`.

**Unused query methods:**

- `fetchOperatorNamesDirect`: `users` with `^[0-9]{3,4}$`; never called.
- `fetchTodayHourlyStatsDirect`, `fetchTodaySummaryDirect` and `fetchTodayOperatorStatsDirect` are thin wrappers.

### 3.5 Metric definitions (how results are interpreted)

| Metric (API field) | Definition |
|---|---|
| `inboundCalls` | distinct `uniqueid` matching P_INBOUND within the day, 08:00–21:00 |
| `answeredCalls` | of those, uniqueids present in S_OP_ANSWERED_UIDS (an operator leg with `billsec>0`). The inbound row's own `disposition` is **not** used, because the IVR or queue answers it. |
| `abandonedCalls` | `inboundCalls − answeredCalls`. Includes IVR hang-ups, queue abandons and off-hours IVR within the window. |
| `abandonedPending/Unreachable/ResolvedCalls` | **estimate**: abandoned split pro-rata by today's SQLite callback counts (pending with 0 attempts / pending with attempts > 0 / resolved) |
| `outboundCalls` | P_OUTBOUND ∧ P_ANSWERED (answered only) |
| `totalCalls` | inbound + outbound(answered) |
| `totalDurationSec` | inbound `SUM(DISTINCT op talk_sec)` + outbound `SUM(billsec)` |
| `uniqueClients/inboundClients`, `answeredClients`, `outboundClients` | `COUNT(DISTINCT src)` inbound; distinct src answered; `COUNT(DISTINCT dst)` outbound answered |
| `deniedCalls`, per-op `denied` | SQLite `operator_reject_events` (no writer, so 0) |
| `missedCalls`, per-op `missed` | SQLite `agent_3cx_call_logs` missed rule (3CX desktop agent), **not CDR** |
| `answerRate`, `abandonedRate` | `/inboundCalls` ×100 rounded |
| `outboundRate`, `denyRate`, `missedRate` | `/totalCalls` ×100 rounded |
| Per-op `rawAnswered` | `SUM(P_ANSWERED)` over rows with `dst = ext` (includes transfer receipts) |
| Transfer chains | XFER rows grouped by identical `channel`, ordered by calldate. For each chain: `xferOut[from]++` per row with `from`; `receipts[to]++` per row with ext `to`; `firstFrom[rows[0].from]++`; `xferIn[last ext to]++`. |
| Per-op `answered` (resolvedIn) | `max(0, rawAnswered − receipts − firstFrom)` |
| Per-op `outbound` | answered outbound legs from `SIP/<ext>-` |
| Per-op `transferredOut` / `transferredIn` = `transferResolved` | `xferOut[ext]` / `xferIn[ext]` (the operator who ended the chain) |
| Per-op `grandTotal` | `answered + outbound + transferredIn`. It is what queue `callsTaken` shows when "DB sync" is on, plus the manual offset. |
| Per-op `totalCalls` | `grandTotal + denied` |
| Per-op `totalDurationSec`, `avgDurationSec` | inbound + outbound billsec; `round(total / (answered + outbound + transferredIn))` |
| Call `direction` | `transfer` if `xfer_chain` is present; `outbound` if `is_out` or `len(src) ≤ 4`; else `inbound` |
| Call operator | `hasRealOp` = `op_ext` is 2–4 chars and ≠ `2020159`, or the call is a transfer. The transfer label is `A (ext) ➔ B (ext) ➔ …`, and the final operator is the last element of the chain. |
| Call `status` | **Q7:** `ANSWERED` if hasRealOp and (`final_disp=ANSWERED` or `talk_sec>0`); `BUSY` if outbound and `final_disp=BUSY`; else `ABANDONED`. Q7 never outputs `DENIED`. **Q9:** `ANSWERED` if `final_disp=ANSWERED` (type ≠ abandoned); `ABANDONED` for type=abandoned; `DENIED` if `final_disp=DENIED` (any FAILED leg); `NO ANSWER` if outbound; else `ABANDONED`. Agent-merged rows use `MISSED`. |
| Call `duration` | `talk_sec` when answered (Q9 with `operatorExt` uses `op_billsec`), else 0 |
| Call `waitSec` | **heuristic, partly fabricated**. Unanswered: `max(wait_sec, talk_sec)`. Answered: `ans_lag_sec`, else `wait_sec − talk_sec`. If 0 and a recording exists, the gap between the recording filename timestamp and calldate (0 < diff < 3600). Then fallbacks: Q7 uses a queue-recording constant clamp (`min(60, max(1, wait−talk))`, else 12); Q9 uses a constant 8. |
| Call `hangupParty` | **not derivable from CDR**; legacy guesses `Mijoz` (customer), `Operator`, `Transfer`, `Band` (busy), `Ko'tarilmadi` (not picked up) or `Javobsiz` (no answer) from the direction and answered flag |
| Callback status | `pending` / `resolved` / `dismissed` in SQLite; see §1.1.6 and Q8 |

### 3.6 Search condition (`buildSmartSearchCondition`)

1. Operator match: name (map or defaults) contains the term or vice versa, or the term is a 2–4 digit extension. For each ext the condition is `((P_ANSWERED AND (dstchannel LIKE '%/ext-%' OR channel LIKE '%/ext-%' OR dstchannel LIKE '%Local/ext@%' OR channel LIKE '%Local/ext@%' OR dst='ext')) OR src='ext')`. The P_ANSWERED part is omitted when `includeDisposition=false`.
2. Phone (≥ 7 digits after stripping non-digits): `src IN (variants) OR dst IN (variants)`, with `LIKE '%digits%'` added when there are fewer than 9 digits. This is OR-ed with the operator condition.
3. Otherwise: `LIKE '%term%'` (SQL-escaped, max 100 chars) on `src`, `dst`, `dstchannel`, `channel`, and `disposition` (when enabled).

### 3.7 Inconsistencies to decide on in the rewrite

1. Extension regex `{2,4}` vs `{3,4}` between live and historical operator stats.
2. The working-hours filter is missing in Q5 and in callbacks Q8, and present elsewhere.
3. Q4 counts answered rows; Q2 and Q6 count distinct operator-answered uniqueids.
4. `SUM(DISTINCT talk_sec)` undercounts talk time.
5. `CURDATE()` uses the PBX clock while date params use Asia/Tashkent.
6. Transfer chains are keyed by `channel` in stats but by `uniqueid`/`channel;` prefix in call lists.
7. `MAX()` over string CASE results picks the "largest" ext, not the one with priority.
8. Outbound only counts answered calls; the dial attempts used by callbacks Q8b are not exposed as KPIs.
9. "Denied" depends on a table with no writer.
10. "Missed" is per-operator from the 3CX agent (zero-length RINGING/ENDED count as missed), unrelated to CDR abandoned.
11. Redis caches past dates for 7 days, so logic changes don't apply retroactively.

### 3.8 Notes for the Kysely/mysql2 rewrite

- Replace the multi-statement scripts and marker parsing with separate typed queries run in parallel. `-N -B` string output (`'NULL'`, `'\N'`) becomes real `null`, so drop all string-NULL checks.
- Configure mysql2 with `dateStrings: true` (or `timezone: '+05:00'`) so `calldate` keeps wall-clock semantics. Legacy treats it as a local `YYYY-MM-DD HH:MM:SS` string everywhere, including string comparisons in Q8.
- `SUM()` returns DECIMAL as a string in mysql2; cast with `CAST(… AS UNSIGNED)` or `Number()`. `COUNT` may return a string with `bigNumberStrings`.
- Keep `calldate >= ? AND calldate < ?` sargable. Apply `TIME(calldate)` filters as secondary predicates. Check existing indexes with `SHOW INDEX FROM cdr` [?]; Issabel typically indexes `calldate`, `dst` and `accountcode`, and `uniqueid` may not be indexed.
- Model the predicates in §3.3 as `ExpressionBuilder` helpers. Use `sql\`\`` for `REGEXP`, `SUBSTRING_INDEX`, `GROUP_CONCAT … ORDER BY … SEPARATOR` and `TIMESTAMPDIFF`.
- On MariaDB 5.5, "latest X per group" has to stay as the `GROUP_CONCAT`/`SUBSTRING_INDEX` trick or move to application code. `group_concat_max_len` defaults to 1024, which is safe because only the first element is used.
- Bind parameters instead of string interpolation. Legacy interpolates dates (regex-validated), extensions (`isExtension`) and `sqlEscape`d search text.

---

## 4. Writes to the PBX

All of these go over SSH as root unless noted. `shellQuote` wraps arguments in single quotes.

| Purpose | Exact command / action | Trigger |
|---|---|---|
| Read the 114 block list | `asterisk -rx "database show blacklist_114"`; parse lines `^/blacklist_114/<num>\s*:\s*<note>$` | every `GET /api/blacklist` (`syncFromAsterisk`) |
| Block a number for ext 114 | for each variant `v` in `[9-digit, 998+9-digit]` (only `^[0-9]{3,15}$`): `asterisk -rx 'database put blacklist_114 <v> "<note>"'; asterisk -rx 'database del blacklist <v>'`. The note is sanitised to `[\p{L}\p{N} _.,:()-]`; empty becomes `1`. | `POST /api/blacklist`. The number is also removed from the **global** FreePBX `blacklist` family so other operators still get the call. The dialplan that checks `blacklist_114` lives on the PBX (custom) [?]. |
| Unblock | per variant: `asterisk -rx 'database del blacklist_114 <v>'; asterisk -rx 'database del blacklist <v>'` | `DELETE /api/blacklist/:number` |
| Pause / unpause an operator | `asterisk -rx "queue pause member Local/<ext>@from-queue/n"` / `"queue unpause member Local/<ext>@from-queue/n"`. No queue name, so it applies to all queues; no reason. `ext` has non-digits stripped. | `POST /api/operator/pause` |
| Reset queue statistics | AMI `Action: Command`, `Command: queue reset stats` (all queues) | Tashkent midnight rollover (amiService) |
| Click-to-call | AMI `Originate` `{channel: 'SIP/<from>', exten: <to>, context: 'from-internal', priority: 1, callerid: <from>}` | `POST /api/action/originate` |
| Transfer | AMI `Redirect` `{channel, exten: <targetExten>, context: 'from-internal', priority: 1}` | transfer endpoint |
| Hang up | AMI `Hangup` `{channel}` | `POST /api/action/hangup` |
| Read-only AMI polling | `CoreShowChannels`, `QueueStatus`, `SIPpeers` (plus the event stream) | amiService |

Suggested AMI replacements, so the new stack needs no SSH root:

- `DBPut` / `DBDel` / `DBGet` with `Family: blacklist_114` (and `blacklist`). Listing needs `Command: database show blacklist_114`.
- `QueuePause` with `Interface: Local/<ext>@from-queue/n` and `Paused: true|false`. Add `Queue` and `Reason` if desired.
- `QueueReset` (optionally per queue) instead of the CLI command.

---

## 5. PostgreSQL mapping

> This is the original plan. What is actually migrated (and what is not, per the owner's decisions of
> 2026-11-18 in `docs/rewrite/DECISIONS.md`) is described in `apps/api/src/scripts/migrate-legacy/README.md`.

### 5.1 Table mapping

| Legacy | New table | Key changes | Action |
|---|---|---|---|
| `auth_users` | `users` | `id bigint` (keep ids); `username citext UNIQUE`; `role` enum (`superuser`, `admin`, `operator`); `operator_ext text NULL` (FK → `operators.ext`); `email citext` with a partial UNIQUE index (dedupe first) [?]; `password_hash text` + `password_algo text` (`scrypt-legacy`); `webauthn_user_id uuid UNIQUE NOT NULL`; `timestamptz` | **migrate** |
| `auth_passkeys` | `webauthn_credentials` | `id text PK` (base64url as-is); `user_id bigint FK ON DELETE CASCADE`; `public_key bytea`; `counter bigint`; `device_type text`; `backed_up boolean`; `transports text[]` (from JSON); `name text`; `created_at`/`last_used_at timestamptz`. Drop the `username`, `operator_id` and `webauthn_user_id` snapshots. | **migrate** |
| `auth_sessions` | `sessions` | `token_hash bytea PK` (sha256 of the token, not plaintext); `user_id FK`; `passkey_id FK NULL ON DELETE CASCADE`; `ip inet`; `expires_at timestamptz` | optional: migrate unexpired sessions (hash tokens), or force re-login |
| `auth_lockouts` | `login_throttle` (or Redis) | split `kind` (`ip`, `user`) and `key` | drop data |
| `auth_password_resets`, `auth_email_verifications` | `password_reset_codes`, `email_verification_codes` | `timestamptz` instead of epoch ms; FK user_id | drop data |
| `system_settings` (SQLite) + `system_settings.json` + `queue-sync-settings.json` | `settings (key text PK, value jsonb, updated_at)` | keys `auth.lockout_threshold`, `auth.lockout_duration_min`, `stats.excluded_operators` (array), `proxmox.auto_recover_vms`, `queue.db_sync_enabled` | **migrate** |
| hard-coded name maps + `asterisk.users` + `excluded_operators` | `operators (ext text PK, display_name, site enum('hq','zangiota'), excluded bool, active bool)` | new single source of truth. Note that 114 is forced to "Maxmudbek", and 119 is shared by Muattar and Zuhra. | create; seed from `asterisk.users` + overrides |
| `agent_3cx_call_logs` | `agent_call_events` | `event_time timestamptz` (Tashkent); `event_type` normalised upper-case enum (map `'1'`→`DIALLED`, `'2'`→`ANSWERED`) keeping `raw_event_type`; `source` enum (`desktop_agent`, `cdr_backfill`) derived from `hostname='Asterisk PBX'`; UNIQUE (`operator_ext`, `caller_id`, `start_time`) | **migrate** |
| `pending_callbacks` | `callbacks` | `status` enum; `source` enum; `resolution_type` enum; rename `dismissed_at`/`dismissed_by` → `closed_at`/`closed_by`; `call_time`, `last_outbound_time`, `created_at`, `updated_at` → `timestamptz`; `last_outbound_operator_ext text` (parse `(\d{2,4})` from the display string) plus the raw label; drop `caller_name` and `notes`; partial UNIQUE (`phone`) WHERE `status='pending'` (dedupe first) | **migrate all rows.** Dismissed and resolved history is required by the "don't resurrect" rule. |
| `client_contacts` | `contacts` | `phone text PK` (normalised; consider E.164 `+998…`); `language text`; `telegram_user_id bigint NULL` (cast `''`→NULL) | **migrate** |
| `call_transcriptions` | `call_transcripts` | key by `recording_file` basename (UNIQUE) plus optional `cdr_uniqueid` (parse from the filename `-(\d+\.\d+)\.wav`); keep `call_key` as legacy alias; `raw_text`, `clean_text`; `created_at timestamptz` (UTC source); drop `topic`, `sub_topic`, `confidence` | **migrate** |
| `stt_learned_rules` + `stt_custom_rules.json` | `stt_rules (id, kind enum('learned','regex'), pattern, replacement, occurrences, …)` | `raw_word citext UNIQUE` for learned rules | **migrate** |
| `blacklist` | `blocked_numbers (number text PK, variants text[], note, scope text DEFAULT 'ext:114', created_at, updated_at)` | `variants` from JSON. Reconcile with AstDB `blacklist_114` at cutover. | **migrate** |
| `calls`, `operator_daily_stats`, `operator_reject_events`, `operator_missed_events` | none | CDR plus `agent_call_events` replace them | **drop** (export a SQL dump to cold storage first; verify reject/missed counts [?]) |
| `call_topic_analytics` | `call_topics` (recomputed from transcripts) | | **drop** (SYNTH) |
| `tickets.json` | `tickets`, `ticket_comments`, `ticket_attachments` | `id text` (`TK-n`) or serial plus legacy code; `status` enum; `accepted_by`/`completed_by`/`rejected_by` → `(*_by_ext, *_by_name, *_at)` columns; `reject_reason`; `created_at`/`updated_at timestamptz` from ms; attachments row per file (copy the files to object storage) | **migrate** (pending, in_progress, rejected; completed are purged weekly anyway) |
| `telegram_subscribers.json` | `telegram_subscribers (chat_id bigint PK, username, first_name, last_name, subscribed_at)` | | **migrate** |
| `rustdesk_devices.json` | `remote_desktop_devices (id, operator_ext NULL, ip inet NULL, hostname, installed, updated_at)` | | migrate |
| `viewer_history.json` | `viewer_sessions` (audit) | | optional |
| `voice_identifications.json`, `voice_candidate_samples.json`, `oybek_samples.json` | `voice_identifications`, `voice_samples` | key by recording basename; `speaker` enum; `is_manual_override`, `is_verified`, `verified_at` | migrate **only if** voice-ID is kept |
| `system_settings.json.lastRecovery` | `proxmox_recovery_runs` | | optional |
| `calls-taken-overrides.json`, `active_channels_state.json`, `voice_scan_status.json`, `ui_inbox.json`, `batch_scan_report.json`, `.internal_token`, temp ZIPs, scratch audio | none | runtime or dev state | **drop** |

### 5.2 Cutover checklist

**Must migrate**, because users lose access or history otherwise:

1. `auth_users`: keep `id`, `username`, `password_hash`, `salt` (§1.3), `role`, `operator_id`, `email` and `webauthn_user_id` exactly.
2. `auth_passkeys`: copy `id`, `public_key` bytes, `counter`, `transports`, `device_type`, `backed_up`, `device_name`, `user_id`. Keep the same RP ID and origins.
3. `system_settings` keys, `queue-sync-settings.json`, `system_settings.json.autoRecoverVms`.
4. `pending_callbacks` (all statuses).
5. `client_contacts`.
6. `agent_3cx_call_logs` (the only history for per-operator missed counts and the 3CX journal).
7. `call_transcriptions`, `stt_learned_rules`, `stt_custom_rules.json`.
8. `blacklist`, reconciled against AstDB `blacklist_114`.
9. `viewer/data/tickets.json` and `viewer/public/uploads/tickets/*`.
10. `telegram_subscribers.json`, `rustdesk_devices.json`.

**Optional:**

- `auth_sessions` (hash tokens, or force re-login).
- `viewer_history.json`.
- Voice-ID JSON files, sample WAVs and `zuhra_profile_ensemble.pt`, if the feature is kept.
- `lastRecovery`.

**Drop:**

- `calls`, `operator_daily_stats`, `operator_reject_events`, `operator_missed_events`, `call_topic_analytics`.
- `auth_lockouts`, `auth_password_resets`, `auth_email_verifications`.
- `calls-taken-overrides.json`, `active_channels_state.json`, `voice_scan_status.json`, `dual_speaker_results.json`, `scratch/*`, `data/temp_zips/*`, `.internal_token`.
- Redis.
- The dead viewer service copies.

**Timestamp conversion rules:**

- Tashkent-local strings: `(ts::timestamp AT TIME ZONE 'Asia/Tashkent')`.
- `datetime('now','localtime')` strings: same rule, but **confirm the prod server TZ** first (`date` on the host) [?].
- `CURRENT_TIMESTAMP` / `datetime('now')`: `AT TIME ZONE 'UTC'`.
- ISO `…Z` strings: cast directly.
- Epoch ms: `to_timestamp(ms/1000.0)`.
- 3CX agent times: verify the format first (§1.0).

**Pre-cutover checks to run on prod** [?]:

- `SELECT COUNT(*) FROM operator_reject_events` and the same for `operator_missed_events`.
- `SELECT email, COUNT(*) FROM auth_users WHERE email IS NOT NULL GROUP BY 1 HAVING COUNT(*)>1`.
- `SELECT phone, COUNT(*) FROM pending_callbacks WHERE status='pending' GROUP BY 1 HAVING COUNT(*)>1`.
- `SELECT DISTINCT event_type FROM agent_3cx_call_logs`.
- On the PBX: `SELECT VERSION()`, `SHOW INDEX FROM asteriskcdrdb.cdr`, `SELECT @@time_zone, @@system_time_zone`.
- Confirm the `blacklist_114` dialplan exists and which queue(s) `Local/<ext>@from-queue/n` belongs to.

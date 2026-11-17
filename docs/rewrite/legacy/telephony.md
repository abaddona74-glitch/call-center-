# Legacy telephony & call-center business logic — behavioral specification

Status: reference for the NestJS rewrite. Describes what the legacy code **does**, not what it should do (corrections are in §8).

- Scope: `legacy/services/amiService.js`, `issabelDbService.js` (sync, callbacks, stats), `dbService.js` (callbacks, calls, agent logs, working hours, phone normalization), `syncService.js`, `blacklistService.js`, `config.js`, and the `legacy/app.js` routes that drive them.
- All `file:line` references are relative to `legacy/`. `ami` = `services/amiService.js`, `idb` = `services/issabelDbService.js`, `db` = `services/dbService.js`, `sync` = `services/syncService.js`, `bl` = `services/blacklistService.js`, `app` = `app.js`.
- `legacy/viewer/services/*` contains older, divergent copies of the same services (out of scope; do not port from them).
- Markers: **[V]** = verified by reading the code path end-to-end. **[S]** = suspected: depends on Asterisk version, CDR row shape, server timezone or desktop-agent payloads that cannot be seen in this repo. §10 lists what to check on the live system.

---

## 0. Big picture

Three independent data sources feed one in-memory singleton (`AmiService`) that broadcasts over WebSocket:

| Source | Transport | Cadence | What it provides |
|---|---|---|---|
| Asterisk AMI (Issabel PBX) | TCP 5038, `asterisk-manager` | push events + 5 s poll | live presence, channels, queue, conversations, "optimistic" counters, callback create/resolve in real time |
| Issabel MariaDB CDR (`asteriskcdrdb.cdr`, `asterisk.users`) | SSH (`ssh2`) → remote `mysql -N -B` via stdin | 5 s (`idb.syncAllData`), 15 s (`ami.syncIssabelData`), on demand | authoritative daily KPIs, per-operator stats, call history, callback sync, operator names |
| 3CX Desktop Agent (Windows app on operator PCs) | HTTP `POST /api/agent/*` | heartbeat ~30 s, per-call events, batch history | agent online flag, per-operator answered/outbound/missed/duration, callback resolution, failed outbound attempts |

Local persistence: SQLite `data/callcenter.db` (`node:sqlite`, WAL) and JSON files in `data/` (§2.12). Redis is used only as a cache for CDR query results.

The "today" KPIs shown on the dashboard come almost entirely from CDR (overwritten every 15 s); AMI live increments only survive until the next sync. Per-operator numbers are a merge of CDR and agent data (§4.4).

---

## 1. AMI connection, polling and timers

### 1.1 Connection

| Item | Behavior | Ref |
|---|---|---|
| Library | `asterisk-manager` `^0.2.0` | `package.json:24`, `ami:1` |
| Construction | `new AsteriskManager(port, host, user, password, events=true)` — the library connects and sends `Login` (Events on) itself | `ami:541-547` |
| Config | `AMI_PORT` (5038), `AMI_HOST` (default `192.168.0.124`), `AMI_USER`, `AMI_PASSWORD` — defaults hardcoded, incl. a password | `config.js:7-13` |
| Reconnect | `ami.keepConnected()` — library-internal reconnect; app sets no backoff/limits | `ami:549` |
| `connect` | `isConnected = true`, broadcast `ami_status {connected:true, host}`, run one poll + an extra `SIPpeers` | `ami:566-574` |
| `disconnect` | `isConnected = false`, broadcast `ami_status {connected:false}` | `ami:576-580` |
| `error` | broadcast `ami_status {connected:false, error}` (does **not** change `isConnected`) | `ami:582-585` |
| `managerevent` | every event → `handleManagerEvent(evt)`; library lowercases keys (`evt.event`, `evt.calleridnum`, …), values keep case | `ami:587-589` |
| Action responses | all poll actions use a no-op callback; responses are ignored, data arrives as events | `ami:602-608` |

`isConnected` flips to true on TCP connect, before login success is confirmed. Whether `asterisk-manager` 0.2 ever emits `disconnect` (rather than `close`/`end`) is unverified **[S]** (node_modules not installed) — see §8 B37.

### 1.2 Polling and outbound AMI/CLI calls

| Trigger | Action(s) | Ref |
|---|---|---|
| every 5 s while `isConnected` | `CoreShowChannels`, `QueueStatus`, `SIPpeers` (in that order). Before sending, `pollChannelsBatch = new Set()` | `ami:554-558`, `ami:595-609` |
| on `connect` | same poll + `SIPpeers` again | `ami:572-573` |
| WS message `{action:'refresh_channels'}` from any dashboard | same poll | `app:1585-1586` |
| Tashkent date change (10 s check) | AMI `Command: queue reset stats` | `ami:2613-2627` |
| user actions | `Redirect`, `Hangup`, `Originate` (AMI); `queue pause/unpause member` and AstDB `database put/del/show` (CLI over SSH) | §6 |

Poll responses come back as events: `CoreShowChannel`×N + `CoreShowChannelsComplete`; `QueueParams` + `QueueMember`×N + `QueueEntry`×N per queue + `QueueStatusComplete`; `PeerEntry`×N + `PeerlistComplete`.

### 1.3 All timers (whole telephony subsystem)

| Timer | Period / delay | Guard | What | Ref |
|---|---|---|---|---|
| `ami.syncIssabelData` | immediately at construction, then every 15 s | **none** (can overlap) | pull CDR caches → overwrite operator stats & summary, refresh call history (50), broadcast, callback sync | `ami:64-65`, `ami:367-535` |
| callback CDR sync window | inside the 15 s sync: 30-day window if last full sync > 30 min ago, else 2-day | `_lastFullCbSync` | `idb.syncPendingCallbacks(days, activePhones)` | `ami:516-525` |
| `ami.checkAgentTimeouts` | 3 s | — | agent ping timeout (38 s), stale ringing (45 s), stale `agentActiveCalls` | `ami:68`, `ami:2977-3039` |
| `ami.checkMidnightRollover` | 10 s | — | Tashkent date change → clear callsTaken overrides, zero counters, `queue reset stats` | `ami:71`, `ami:2580-2608` |
| AMI poll | 5 s | `isConnected` | §1.2 | `ami:554` |
| state snapshot write | debounced 1 s after each `recalculateConversations` | — | `data/active_channels_state.json` | `ami:167-172`, `ami:2352` |
| outbound map cleanup | `setTimeout` 5 s after a Hangup that matches an outbound | — | `operatorOutboundCalls.delete(opId)` | `ami:1987-2004` |
| `idb.syncAllData` | immediately at construction, then 5 s | `isSyncing` | one 8-section multi-SQL → `idb.cache.{summary,hourly,operators}`, operator names; also writes Redis keys TTL 60 s | `idb:122-138`, `idb:140-523` |
| `sync` scheduler | 30 s tick | `isSyncRunning` | at 21:00 Tashkent once/day, and every minute where `minute % 15 == 0`: CDR → `agent_3cx_call_logs` backfill | `sync:35-74` |
| execQuery timeout | 90 s default per SQL | — | rejects | `idb:921-965` |
| execCommand timeout | 10 s default | — | **resolves `''`** (silent) on timeout | `idb:970-1013` |
| historical caches | 5 min in-memory, 7 days Redis (past dates), 15–60 s Redis for today/`all` | — | | `idb:1187-1199`, `idb:1907-1915`, `idb:2132` |

Other time constants used in logic: 38 s agent ping timeout (`ami:2455`, `ami:2980`), 45 s stale ringing (`ami:285`, `ami:2490`, `ami:2981`, `ami:3022`), 1 h stale agent talk (`ami:3023`), 2 s "fresh ring" protection (`ami:1446`), 60 s outbound dedupe (`ami:1866`), 90 s "recent answered" (`ami:1950`), 5 min max age of the state snapshot (`ami:91`), 5 s reject/missed dedupe (`db:268`, `db:353`), 90 s agent MISSED dedupe (`db:783`), 20 s failed-outbound dedupe (`db:1498`), ±120 s CDR→agent dedupe (`sync:124`), ±3 min CDR/agent merge in call details (`idb:2500`).

### 1.4 SSH / MySQL channel to the PBX

- One persistent `ssh2` connection (`SSH_HOST`/`SSH_USER` default `192.168.0.124`/`root`), lazily (re)opened; on `error`/`close` the cached promise is dropped so the next call reconnects (`idb:893-913`).
- SQL is written to `mysql -u <ASTERISK_DB_USER> -N -B` stdin with `MYSQL_PWD` env (`idb:929-962`). Output is TSV; multi-statement results are split on literal `===MARKER===` rows (`idb:264-270`). NULL arrives as the string `NULL` / `\N`, handled ad hoc.
- CLI commands (`asterisk -rx ...`, `find`) go through `execCommand` which rejects only if exit≠0 **and** stderr **and** no stdout; timeout resolves `''` (`idb:1002-1010`, `idb:982-988`).

### 1.5 Restart survival

- On construction, `data/active_channels_state.json` is loaded if younger than 5 min: restores `activeChannels` (+ `channelToOperator` for channels with `operator`) and `operatorOutboundCalls` (`ami:85-125`).
- Written (debounced) after every `recalculateConversations`, and synchronously on SIGINT/SIGTERM; an empty snapshot is not written before the first CDR sync completes (`ami:127-165`, `ami:76-82`). The signal handlers do not call `process.exit`.
- Operators, queues, conversations, call history and AMI counters are **not** persisted; they rebuild from the next poll/sync.

---

## 2. In-memory state model (`AmiService`, `ami:19-61`)

### 2.1 `operators: Map<ext, Operator>`

Created only via `ensureOperatorExists(id)` (`ami:2355-2395`), which is a no-op for excluded extensions (`system_settings.excluded_operators`, via `idb.getExcludedOperators`). Callers: almost every event handler, heartbeat, call-event, sync-batch, adjust. Removed only by the exclude-list endpoint (`app:885-889`).

| Field | Type | Written by | Notes |
|---|---|---|---|
| `id` | string ext | create | |
| `name` | `"Real (ext)"` or `"Operator ext"` | create; CDR sync (`ami:411`, `ami:445`); recomputed in `getOperatorList` | 114 forced to `Maxmudbek` (`ami:2450`) |
| `realName` | string | create; CDR sync | from `idb.operatorNames` |
| `presence` | `offline\|ready\|paused\|ringing\|talking` | many (§2.2) | internal value; the value sent to clients is re-derived (§2.2.2) |
| `ip`, `latency` | string | `PeerEntry` (`ami:711-712`) | `latency` = raw SIP status, e.g. `OK (5 ms)`, `UNREACHABLE` |
| `paused` | bool | `QueueMember`, `QueueMemberPaused/Status`, `/api/operator/pause` | |
| `ringingCaller` | string or null | AgentCalled, DialBegin, Newchannel, originate, recalc | outbound rings are prefixed `📤 ` — this prefix is used as a direction flag (`ami:246`, `ami:1447`, `ami:2140`) |
| `ringingSince`, `talkingSince` | epoch ms or null | many | `talkingSince` drives the UI talk timer |
| `callsTaken` | int | `QueueMember.callstaken` (raw Asterisk) | `ami:815`; zeroed at midnight |
| `lastCall` | epoch s | `QueueMember.lastcall` | |
| `queuePosition`, `penalty` | int | `QueueMember` | position = order of `QueueMember` events in the current `QueueStatus` cycle (`ami:799-808`) |
| `answered`, `outbound`, `transferredOut`, `transferredIn`, `transferResolved`, `totalDurationSec`, `avgDurationSec`, `totalCalls` | int | overwritten every 15 s from CDR + agent (`ami:403-434`); transient increments by AgentConnect/AgentComplete | see §4.3 |
| `denied`, `missed` | int | from SQLite (`getTodayOperatorRejects/Missed`) on create, sync and in `getOperatorList` | |
| `clientHangup`, `operatorHangup` | int | AgentComplete only (`ami:1231-1235`) | in-memory, zeroed by the date-change branch in `syncIssabelData` (`ami:377-394`); exposed via `getOperatorList` spread |
| `agentConnected`, `lastAgentPing`, `agentHostname`, `agentVersion` | | `/api/agent/heartbeat` (`app:3499-3503`); `checkAgentTimeouts` | `exten` is read by `/api/agent/status-all` but never set |
| `grandTotal`, `callsTakenOverride`, `queueDbSync` | | added only on the output copy in `getOperatorList` | |

#### 2.2.1 Presence writers (internal `op.presence`)

| Source | Effect | Ref |
|---|---|---|
| `PeerEntry` (5 s poll) | status contains `OK` or `REACHABLE` → if not talking/ringing: `paused ? paused : ready`; else → `offline`. Also sets `ip`, `latency`. Note `'UNREACHABLE'.includes('REACHABLE')` is true | `ami:691-716` |
| `PeerStatus` | `registered`/`reachable` → if not talking: `paused ? paused : ready` (overrides `ringing`); `unregistered`/`unreachable` → `offline` | `ami:724-741` |
| `QueueMember` (5 s poll) | skipped entirely if the op has an entry in `activeConversations`. Else sets `paused`; paused → `paused`; status 1 → `ready` unless ringing; 2/3 → `talking`; 4/5 → `offline`; 6 → `ringing`; 0/7/8 ignored | `ami:823-851` |
| `QueueMemberPaused` / `QueueMemberStatus` | only the `paused` field is used: paused → `paused` unless talking; unpaused & `paused` → `ready`. Device status in `QueueMemberStatus` is ignored | `ami:856-881` |
| `ExtensionStatus` | `(status & 8)` → `ringing`; 0 → `paused/ready` unless ringing; 1 → `talking` unless ringing; 4 or -1 → `offline`; 2,16,… ignored. `-1 & 8 === 8`, so -1 lands in ringing | `ami:890-923` |
| `AgentCalled` | `ringing` unless talking; `ringingCaller` = caller | `ami:1082-1105` |
| `AgentRingNoAnswer` | ringing → `ready`; clear ringing fields | `ami:1108-1125` |
| `AgentConnect` (A) | `talking` | `ami:1147` |
| `AgentComplete` | `ready` | `ami:1227` |
| `QueueCallerAbandon` (A) | every op ringing with `ringingCaller === caller` → `ready` | `ami:997-1010` |
| `DialBegin` (B) | dest op → `ringing` unless talking (`ringingCaller` = caller); src op (outbound) → `ringing` unless talking (`📤 number`) | `ami:1319-1328`, `ami:1361-1370` |
| `DialEnd` (B) | `ANSWER` → `talking`; otherwise if ringing and (ring older than 2 s or outbound ring) → `ready` if valid IP else `offline` | `ami:1404-1412`, `ami:1440-1457` |
| `Newchannel` | detected outbound → `ringing` (`📤 exten`) unless talking | `ami:1690-1698` |
| `BridgeEnter` / `Bridge(Link)` | first detected op → `talking` | `ami:1788-1797` |
| `Hangup` | op of the channel (not `Local/`) → `ready` if valid IP else `offline`; clear ringing/talking | `ami:2006-2014` |
| `AttendedTransfer`/`BlindTransfer` | from-op → ready/offline by IP; target ext → `talking` | `ami:2028-2038` |
| `recalculateConversations` | op with an Up SIP channel → `talking`; outbound not yet answered → `ringing` | `ami:2072`, `ami:2223-2236` |
| `checkAgentTimeouts` | agent lost & no valid IP → `offline`; ringing > 45 s → ready/offline | `ami:2985-3014` |
| `POST /api/operator/pause` | immediate paused/ready | `app:3436-3443` |
| `POST /api/action/originate` | immediate `ringing` | `app:3271-3277` |

"Valid IP" = `ip` not in `'', '-none-', '(null)'` (sometimes also `latency` not containing `UNREACHABLE`).

#### 2.2.2 Presence sent to clients (`getOperatorList`, `ami:2397-2521`)

Evaluated per operator, first match wins:

1. no valid IP (or latency contains `UNREACHABLE`) → `offline` (even if the desktop agent is connected or a call is up).
2. op in `activeOpIds` → `talking`. `activeOpIds` = ops of `activeConversations` entries with `stateType==='talking'` ∪ ops whose own `^P?J?SIP/(1\d\d|2\d\d|4\d\d)[-_]` channel has state containing `up`/`talk` (`ami:2402-2421`). Sets `talkingSince` from the conversation start if missing.
3. `op.paused` or presence `paused` → `paused`.
4. (`presence==='ringing'` or `ringingCaller` set) and ring not older than 45 s → `ringing`.
5. otherwise `ready` (an internal `offline` with a valid IP is shown as `ready`).

Side effects: clears `op.ringingCaller/ringingSince/talkingSince` in several branches (it is a getter that mutates state). Output sort: ringing, ready, talking, paused, offline, then numeric id (`ami:2424`, `ami:2515-2520`). `agentConnected` = last ping < 38 s.

### 2.3 `activeChannels: Map<channelName, Channel>`

| Field | Set by |
|---|---|
| `channel`, `callerId`, `callerName`, `context`, `application` | `Newchannel`, `CoreShowChannel` |
| `extension` | `Newchannel`: `exten \|\| extension \|\| context \|\| 'Linya'`; `CoreShowChannel`: `extension \|\| context` |
| `state` | `Newchannel` → `'Ring'`; `CoreShowChannel` → `channelstatedesc`/`channelstate`; `'Talking'` on DialEnd ANSWER, AgentConnect (B), Bridge |
| `direction` | `inbound`/`outbound` heuristics: Newchannel (op ext + external exten + non-queue context), CoreShowChannel (tracked outbound or op caller dialing ≥7 digits), Dial*, AgentConnect, Hangup |
| `duration` | `CoreShowChannel` `HH:MM:SS` |
| `startTime` | Newchannel `now`; CoreShowChannel `now − duration` (or uniqueid epoch), keeps existing unless it is >15 s younger than Asterisk's duration |
| `answeredTime` | DialEnd ANSWER, AgentConnect (B), Bridge; CoreShowChannel when state Up |
| `dialedPhone` | outbound number (Newchannel/Dial*/CoreShowChannel from tracked outbound) |
| `operator` | ext bound to the channel |
| `pairedChannel` | DialBegin (B), AgentConnect (A), Bridge — **dropped by every CoreShowChannel rebuild** (`ami:1625-1639`) |

Insert: `Newchannel` (skips `Local/*@from-queue*` and `*;2`), `CoreShowChannel` (all channels incl. `Local;1`). Delete: `Hangup`, `CoreShowChannelsComplete` prune (any channel not seen in the current poll batch, `ami:1647-1660`), `/api/action/hangup`.

### 2.4 `channelToOperator: Map<channel|uniqueid, ext>`

Written by `setChannelOperator` (caps at 2000 entries by evicting the oldest 500, `ami:616-623`) from Dial*, AgentConnect, Bridge, CoreShowChannel, Newchannel. Deleted by Hangup (channel and uniqueid) and the CoreShowChannelsComplete prune. Read as the fallback operator for nearly every event and, importantly, as an "answered" signal in Hangup (`ami:1885`).

### 2.5 `queues: Map<queueName, Queue>` and `queueWaitingList`

| Field | Source |
|---|---|
| `name`, `strategy` | `QueueParams` (strategy change → broadcast `queue_strategy_update` with `getActiveQueueStrategy()` = strategy of the queue whose name contains `2020159`, else first non-`default`) |
| `callsWaitingCount`, `completedCalls`, `abandonedCalls` | `QueueParams` (`calls`, `completed`, `abandoned`); `callsWaitingCount` also recomputed on Join/Leave |
| `callersWaiting[]` `{callerId, clientName, clientOrg, position, waitSec, channel, joinTime?}` | cleared by every `QueueParams`, refilled by `QueueEntry` (dedupe by `callerId`); appended by `QueueCallerJoin`; removed by `QueueCallerLeave` (by channel) |
| `agents[]` | ext list, appended by `QueueMember`, never pruned |
| `memberOrder[]` | reset each `QueueParams`, refilled by `QueueMember` order → `op.queuePosition` |

A queue missing from the map is created by `QueueCallerJoin` with default name `2020159` and strategy `fewestcalls` (`ami:948-960`).

`queueWaitingList` (what the UI shows) is rebuilt in `recalculateConversations` (`ami:2278-2347`): all `callersWaiting` of all queues, plus every non-`Local` external channel that is not paired/bound to an operator, not outbound, context not `from-internal`/`out`/`dialout`, and looks like queue/trunk/IVR (`context` contains `queue`, `from-trunk`, `ivr`, or app contains `queue`, or `extension==='2020159'`). So callers still in the IVR appear as "waiting in queue". `getQueueSummaryList` returns a single synthetic queue `Asosiy Navbat` whenever the waiting list is non-empty (`ami:2921-2953`).

### 2.6 `activeConversations: Map<key, Conversation>`

Rebuilt wholesale by `recalculateConversations` (`ami:2049-2353`) with key `TALK_<ext>`:

`{key, callerId, operator (display), operatorExten, state ('Suhbatda' | 'Chiquvchi suhbat' | "Chiquvchi chaqiruv..."), stateType ('talking'|'ringing'), direction, channel (client channel if paired, else operator channel), startTime, duration}`.

Algorithm:
1. Operator channels = non-`Local` channels whose name starts `SIP/1`, `PJSIP/1`, `SIP/2`, `PJSIP/2`, `SIP/4` and resolve to an ext. Those in state up/talk/`6` are "active operators" (one per ext; last channel wins); everything else is an "external channel".
2. Pair each active operator with an external channel: first by explicit binding (`ec.op === op`, `channelToOperator`, `pairedChannel` either way), else any unbound external channel in state up. A channel bound to another operator is never taken.
3. Direction: `outbound` if `operatorOutboundCalls` has the op (or matches either channel); else `inbound` if the paired context is trunk/queue or either channel is marked inbound; else `outbound` if a dialout context, `📤` ringing or channel direction says so.
4. Caller number: outbound → first plausible number from saved outbound / ringing / dialedPhone / extensions / caller IDs; inbound → paired channel caller ID; fallback `Mijoz (Ulangan)` / `Chiquvchi mijoz`.
5. Outbound where the paired channel is not up and has no `answeredTime` → `stateType ringing`, operator presence forced to `ringing`.
6. Start time: operator channel `answeredTime` → paired `answeredTime` → `talkingSince` → `now − duration` → startTimes; corrected to `now − duration` if more than 15 s younger than Asterisk's duration.

`AgentConnect` (A) also inserts an entry keyed by caller number and `AgentComplete` deletes by that key (`ami:1177-1189`, `ami:1243-1244`); these are overwritten on the next recalculation.

### 2.7 `callHistory: Call[]` (recent-calls feed)

- AMI pushes records (unshift, cap 500) from AgentComplete, QueueCallerAbandon (B) and Hangup (`ami:1279-1280`, `ami:1520-1521`, `ami:1925-1926`).
- Every 15 s it is **replaced** by `[AMI records newer than the newest CDR call] + 50 newest CDR calls` (cap 100) (`ami:476-510`). CDR records have `channel: ''`, `cause: 'CDR'`.
- Used for the WS feed (`call_history_sync`, `call_hangup`, `initial_state.callHistory`), Hangup de-duplication (`ami:1863-1867`) and the "recent answered within 90 s" check (`ami:1945-1952`).

### 2.8 `operatorOutboundCalls: Map<ext, Outbound>`

`{dialedNumber, targetPhone (normalized), channel, destChannel, startTime (ms), answeredTime?}` — one entry per operator.

| Writer | Ref |
|---|---|
| generic Dial block (DialBegin/**DialState/DialEnd**) when the src is an operator and the dest is not | `ami:1021-1038` |
| DialBegin (B) outbound branch | `ami:1340-1346` |
| Newchannel outbound detection | `ami:1683-1689` |
| `/api/action/originate` (channel `SIP/<from>`) | `app:3262-3270` |
| CoreShowChannel fills missing `channel`/`destChannel` | `ami:1577-1583` |
| `answeredTime`: DialEnd ANSWER, Bridge | `ami:1399-1403`, `ami:1798-1802` |

Deleted: DialEnd non-ANSWER for the same channel (immediately), Hangup of either channel (after 5 s), agent ping timeout.

### 2.9 `agentActiveCalls: Map<ext, {callerId, eventType, timestamp}>`

From `/api/agent/call-event`: `ANSWERED`/`RINGING` set, `ENDED`/`MISSED` delete (`ami:174-186`). Purged when the op is offline, RINGING older than 45 s, or older than 1 h (`ami:3017-3030`). Only used to mark callbacks as "currently in a call" (§5.11).

### 2.10 `stats` and hourly arrays

`stats = {totalCalls, inboundCalls, outboundCalls, answeredCalls, abandonedCalls, clientHangupCalls, operatorHangupCalls, deniedCalls, queueAbandonedCalls, totalDurationSec}` (`ami:35-45`). Only `clientHangupCalls`/`operatorHangupCalls` are effectively used; the rest are overwritten from CDR every 15 s and only read when `idb.cache.summary` is null. `hourlyInbound/hourlyOutbound` (`ami:32-33`) and `stats.queueAbandonedCalls` are written and never read.

### 2.11 Queue `callsTaken` override state

- `manualCallsTakenOverrides: {ext: offset}` persisted to `data/calls-taken-overrides.json`; cleared at Tashkent midnight (`ami:2586-2588`, `ami:2651-2680`).
- `queueDbSyncEnabled` persisted to `data/queue-sync-settings.json` (`{enabled, mode:'grandTotal', updatedAt}`); **defaults to true** when the file is missing (`ami:2526-2556`). Current file: enabled.
- Semantics in §6.4. None of this is written back to Asterisk.

### 2.12 `issabelDbService` state

- `operatorNames: Map<ext, name>` seeded from `DEFAULT_OPERATOR_NAMES` (`idb:9-17`), refreshed every 5 s from `asterisk.users` (`extension REGEXP '^[0-9]{2,4}$'`); empty name → default → `Operator <ext>`; `114` always forced to `Maxmudbek` (`idb:273-288`). `getOperatorName(ext)` strips a trailing `(ext)` (`idb:2824-2830`). `fetchOperatorNames()` used by the 15 s sync is a no-op apart from the 114 override (`idb:1043-1046`).
- `cache = {summary, hourly, operators, lastSync}` — written only by `syncAllData` (§4).
- `EXCLUDED_OPERATORS` (module Set, loaded from `system_settings.excluded_operators`) — note `db` and `sync` have their own **never-populated** `EXCLUDED_OPERATORS` sets (`db:10`, `sync:14`).

### 2.13 Parsing helpers (used everywhere)

| Helper | Rule | Ref |
|---|---|---|
| `extractOperatorExten(...vals)` | first value that: is not a technical word (`ext-queues`, `from-queue`, `from-internal`, …); does not look like an external number (`^(998)?(71\|78\|90\|91\|93\|94\|95\|97\|98\|99\|33\|88)\d{4,}` or ≥5 digits); then matches `Local/(\d{2,4})@`, `(SIP\|PJSIP\|Local\|IAX2\|Agent\|DAHDI)/(\d{2,4})`, `Operator\s*(\d{2,4})`, or a bare 2–4 digit string — rejecting results starting `71` (and `90` for bare digits) | `ami:628-662` |
| `extractCallerNumber(...cands)` | first `(998)?\d{7,12}` match in any candidate that is not `712020159`/`…2020159` and whose digit group does not start `000`; returns the match including any `998`; fallback string `Yashirin raqam (Hidden)` | `ami:668-685` |
| `parseDurationSec` | `H:M:S`, `M:S`, or int | `ami:8-16` |
| `getMatchablePhone9` | last 9 digits if ≥9 digits | `ami:188-192` |
| `db.normalizePhone` | §5.2 | `db:1089-1104` |

---

## 3. AMI event handling

### 3.1 Dispatch model and order dependency

`handleManagerEvent` (`ami:687-2044`) is a flat sequence of independent `if (evt.event === X)` blocks; for one event every matching block runs, in source order. Several event types therefore have **two handlers**:

| Event | Handlers (in execution order) |
|---|---|
| `DialBegin` | generic Dial block `ami:1014-1073` → DialBegin (B) `ami:1292-1372` |
| `DialEnd` | generic Dial block `ami:1014-1073` → DialEnd (B) `ami:1375-1459` |
| `DialState` | generic Dial block only |
| `AgentConnect` | (A) `ami:1128-1194` → (B) `ami:1462-1488` |
| `QueueCallerAbandon` | (A) `ami:988-1011` → (B) `ami:1491-1538` |

The generic and (B) DialBegin handlers disagree: the generic block intentionally does **not** bind the caller channel to the rung operator for inbound (comment `ami:1055-1056`), while DialBegin (B) does (`ami:1301-1304`, `ami:1311-1315`).

`return` statements inside `Newchannel` and `Hangup` exit the whole function; since those are the last blocks for their event types the practical effect is skipping the rest of that block (including cleanup, §8 B32).

Cross-event dependencies:
- Hangup de-duplication assumes `AgentComplete` / `QueueCallerAbandon` for the same caller channel arrive **before** that channel's `Hangup` and are still in `callHistory`.
- Hangup "answered" detection relies on bindings made by DialBegin/AgentConnect/Bridge earlier in the call.
- AMI increments of `op.answered`, `op.totalCalls`, `op.totalDurationSec` and `stats.*` are overwritten by the next 15 s CDR sync.
- The 5 s `QueueMember` poll would overwrite presence, so it is skipped while the op has an `activeConversations` entry.

### 3.2 Event table

"Persist" = SQLite (`callcenter.db`) writes. Broadcast names are WS `type`s (`{type, data, timestamp}`).

| Event | State changes | Persist | Broadcast | Ref |
|---|---|---|---|---|
| `PeerEntry` (SIPpeers poll) | discover op from `objectname`; presence/ip/latency (§2.2.1) | — | — | `ami:691-716` |
| `PeerlistComplete` | — | — | `operators_update` | `ami:719-721` |
| `PeerStatus` | presence on register/unregister | — | `operators_update` | `ami:724-741` |
| `QueueParams` | upsert queue; reset `callersWaiting`, `memberOrder` | — | `queue_strategy_update` on strategy change | `ami:744-788` |
| `QueueMember` | `memberOrder`, `agents`, `queuePosition`, `penalty`, raw `callsTaken`, `lastCall`; `paused` + presence unless in conversation | — | — | `ami:791-853` |
| `QueueMemberPaused`, `QueueMemberStatus` | `paused` and presence from the `paused` field only | — | `operators_update` | `ami:856-881` |
| `QueueStatusComplete` | — | — | `queue_update`, `operators_update` | `ami:884-887` |
| `ExtensionStatus` | presence from status bits | — | `operators_update` | `ami:890-923` |
| `QueueEntry` | add waiting caller (contact lookup) if callerId not present | — (reads `client_contacts`) | — | `ami:926-944` |
| `QueueCallerJoin` | push waiting caller `{joinTime: now}`; `recalculateConversations()` | — | via recalc (5 types) | `ami:947-974` |
| `QueueCallerLeave` | remove waiting caller by channel; recalc | — | via recalc | `ami:977-985` |
| `QueueCallerAbandon` (A) | `stats.queueAbandonedCalls++`; ops ringing for this caller → ready | — | `stats_update`, `operators_update` | `ami:988-1011` |
| `QueueCallerAbandon` (B) | `stats.abandonedCalls++`; history record `ABANDONED` (`operator: 'Navbat (Kutishda uzildi)'`, `waitSec = holdtime`, time = uniqueid epoch or now−holdtime) | `calls` (saveCall); `pending_callbacks` upsert `source='abandoned'` (no working-hours / active-call check) | `call_hangup`, `stats_update`, `callbacks_update` | `ami:1491-1538` |
| Generic `DialBegin`/`DialState`/`DialEnd` | dest op → bind dest channel/uniqueid; mark channels inbound. src op only → bind all 4 ids, (re)create `operatorOutboundCalls[src]`, mark channels outbound with `dialedPhone` | — | — | `ami:1014-1073` |
| `DialBegin` (B) | inbound: bind **dest and caller** channels to dest op, set `pairedChannel`, op ringing with caller. outbound: bind, recreate outbound entry, op ringing `📤 num` | — | `operators_update` | `ami:1292-1372` |
| `DialEnd` (B) `ANSWER` | both channels `Talking` + `answeredTime`; outbound `answeredTime`; op `talking` | — | `operators_update` | `ami:1385-1412` |
| `DialEnd` (B) other (`BUSY`, `NOANSWER`, `CANCEL`, `CONGESTION`, `CHANUNAVAIL`) | if it is this op's tracked outbound: record failed attempt, delete outbound entry; ringing op → ready/offline (unless inbound ring < 2 s old) | `pending_callbacks` failed attempt (§5.7) | `callbacks_update` (if updated), `operators_update` | `ami:1413-1458` |
| `AgentCalled` | op `ringing` with caller | — | `operators_update` | `ami:1082-1105` |
| `AgentRingNoAnswer` | ringing → ready; clear ringing | — | `operators_update` | `ami:1108-1125` |
| `AgentConnect` (A) | bind channel+destchannel to op; op `talking`, `totalCalls++`, `answered++`; channels inbound + paired; `stats.answeredCalls++`; conversation keyed by caller | — | `active_conversations_update`, `stats_update`, `operators_update` | `ami:1128-1194` |
| `AgentConnect` (B) | channels `Talking` + `answeredTime` + operator | `pending_callbacks` resolve (`client_inbound`, by `operator_<ext>_inbound`) | `callbacks_update` (if resolved) | `ami:1462-1488` |
| `AgentComplete` | hangup party from `reason` (`agent`→Operator, `transfer`→Transfer, else Client); `stats.operatorHangupCalls/clientHangupCalls++`, `stats.totalDurationSec += talktime`; op ready, `totalDurationSec += talktime`, `avg = total/answered`, `operatorHangup++` or `clientHangup++` (not for transfer); delete conversation; history record `ANSWERED` (direction `transfer` or `inbound`, `waitSec = holdtime`, start = uniqueid epoch or now−talk−hold, random id) | `calls` + `operator_daily_stats` (saveCall) | `call_hangup`, `active_conversations_update`, `stats_update`, `operators_update` | `ami:1197-1289` |
| `CoreShowChannel` (poll) | add to poll batch; rebuild channel record (direction/startTime/answeredTime heuristics, §2.3); bind tracked outbound channels; ensure op exists | — | — | `ami:1541-1644` |
| `CoreShowChannelsComplete` | prune channels not in batch (+ their `channelToOperator`); recalc | — | via recalc | `ami:1647-1660` |
| `Newchannel` | skip `Local/*@from-queue*` and `*;2`. Outbound if op ext and external `exten` and context not queue/trunk/pstn/ivr → bind, outbound entry, op ringing. Always `stats.totalCalls++` and inbound/outbound++, hourly arrays++ (server-local hour); add channel `state:'Ring'`; recalc | — | via recalc + `stats_update` | `ami:1663-1728` |
| `BridgeEnter` / `Bridge` (`bridgestate=link`) | cross-bind operator between `channel1/channel2` (legacy Bridge only); each listed channel → `Talking`, `answeredTime=now`, operator; outbound with dialed number → resolve callback; first op → `talking`, outbound `answeredTime`; recalc | `pending_callbacks` resolve (`operator_outbound`) | `callbacks_update` (if resolved), via recalc, `stats_update`, `operators_update` | `ami:1731-1808` |
| `Hangup` | see §3.3 | `calls`, `operator_daily_stats`, `pending_callbacks` | `call_hangup`, `callbacks_update`, `active_conversations_update`, `operators_update` (+ recalc) | `ami:1811-2019` |
| `AttendedTransfer`, `BlindTransfer` | from-op (from `origtransfererchannel`/`transfererchannel`) → ready/offline; target (`extension` or `targetchannel`) → talking; recalc | — | `operators_update`, `active_conversations_update` + recalc | `ami:2022-2043` |

`recalculateConversations` always broadcasts 5 messages: `active_conversations_update`, `queue_update`, `stats_update`, `operators_update`, `callbacks_update` (`ami:2343-2351`). Each of those re-runs several SQLite queries (`getTodayOperatorRejects/Missed`, `getTodayAgentOperatorStats`, `getCallbacks` ×2), and it runs at least every 5 s (CoreShowChannelsComplete) plus on most call events.

### 3.3 Hangup algorithm (`ami:1811-2019`)

1. `Local/*@from-queue*` or `*;2` → delete from `activeChannels`, **return**.
2. If the channel is in `activeChannels`, remove it, then:
   - `opId = channel.operator || channelToOperator[channel] || ext parsed from channel name`.
   - `oCall` = outbound entry of `opId` or any outbound entry referencing this channel.
   - outbound if channel direction is outbound, or has `dialedPhone`, or `oCall`, or it is an operator SIP channel whose `extension` has ≥7 chars and context is not queue.
   - `dialedNumber` from channel/oCall, else extracted from extension/callerName/callerId.
   - Trunk channel (`SIP/712020159*`) + outbound + no dialed number → **return**.
   - `isExternal` = trunk channel, or inbound, or callerId ≥7 chars, or outbound with a dialed number.
   - `rawNum` = dialed number (outbound) or caller number (inbound).
   - Skip if already in `callHistory`: same channel, same uniqueid, or (outbound and same number-or-operator and record `time` within 60 s of now).
   - If external, not in history, not `Local/`: invalid number (empty, trunk, <7, hidden) → **return**. Otherwise:
     - `hasRealOperator` = 2–4 digit `opId`.
     - answered: outbound → `billsec>0 || answeredTime || oCall.answeredTime`; inbound → `hasRealOperator && (answeredTime || (billsec>0 && state==='Talking') || channelToOperator.has(channel))`.
     - duration: `billsec` → `now − answeredTime` → `now − oCall.answeredTime` → `now − oCall.startTime` → `now − startTime` (if real op) → `evt.duration`.
     - `waitSec` = inbound: `(now − start) − duration`; outbound: 0.
     - record `{status: ANSWERED | 'NO ANSWER' (outbound) | ABANDONED (inbound), hangupParty: answered ? (outbound ? 'Operator' : 'Mijoz tugatdi') : (outbound ? 'Javobsiz' : "Ko'tarilmadi"), cause: 'Hangup (<cause>)', time: start in Tashkent}` → `callHistory`, `saveCall`, broadcast `call_hangup`.
     - Callbacks for the normalized number: answered with op → `resolveCallback` (type by channel direction); inbound not answered → create only if trunk channel, not an operator SIP channel, caller not in any active call, and no inbound ANSWERED record for that number in the first 30 history entries within 90 s; source = `isWorkingHours(callStartTime) ? 'abandoned' : 'ivr_non_working'`; outbound not answered → `recordFailedOutboundAttempt(cause = Hangup cause code)`.
3. Always (unless returned above): delete `channelToOperator` for channel and uniqueid; schedule 5 s deletion of matching outbound entries; reset the hanging-up operator's presence (non-`Local`); recalc; broadcast.

### 3.4 Events not handled

`Newstate`, `BridgeLeave`, `QueueMemberPause` (Asterisk 13+ name; only the Asterisk 11/12 `QueueMemberPaused` is matched, though 13+ pause changes still arrive via `QueueMemberStatus.paused`), `DeviceStateChange`, `AgentDump`, `QueueMemberAdded/Removed`, `Hold/Unhold`, `Masquerade`/`Rename`, `Cdr`, `Dial`/`Join`/`Leave` (Asterisk 11 names), `VarSet`, `DTMF*`. The handler mixes Asterisk ≥12 names (`DialBegin`, `BridgeEnter`, `QueueCallerJoin`, `AttendedTransfer`) with Asterisk 11 ones (`Bridge` link, `QueueMemberPaused`) and field names (`evt.extension` in CoreShowChannel); the real PBX version must be confirmed (§10).

---

## 4. Metric definitions (as implemented)

### 4.1 Sources and windows

| Source | Window | Day boundary |
|---|---|---|
| CDR today (`idb.syncAllData`) | `calldate >= CURDATE()` and `TIME(calldate)` between `08:00:00` and `21:00:00` inclusive | PBX MariaDB timezone |
| CDR past date (`fetchFullStatsByDate`, `fetchOperatorStats`) | `calldate` within the date, same 08–21 filter | PBX TZ |
| CDR `fetchSummaryByDate` (`/api/db/summary`) | whole day, **no** 08–21 filter | PBX TZ |
| SQLite operator rejects/missed | `event_time` on date, 08:00:00–21:00:00 | Tashkent strings |
| SQLite agent stats (`getTodayAgentOperatorStats`) | 00:00:00–23:59:59 | Tashkent strings |
| AMI counters | since process start / last date change | Node `Asia/Tashkent` |

### 4.2 Building blocks (CDR SQL, `idb:142-258`)

- **Inbound row set `IN`**: `dcontext IN ('ext-queues','from-trunk','ivr-4') OR channel LIKE 'SIP/712020159%'`, `channel NOT LIKE 'Local/%'`, `dcontext` NULL or ≠ `from-internal`, `src` NULL or not 1–4 digits.
- **Operator-answered uniqueid set `OPANS`**: rows with `disposition='ANSWERED' AND billsec>0` and (`dst` is 2–4 digits, or `dstchannel LIKE 'Local/%@from-queue%'`, or `dstchannel LIKE 'SIP/%'` not containing `2020159`); `talk_sec = MAX(billsec)` per uniqueid. This subquery is not limited to 08–21.
- **Outbound row set `OUT`**: `dcontext='from-internal'`, `channel REGEXP '^SIP/[0-9]{2,4}-'`, `LENGTH(dst) >= 7`.
- **Transfer rows `XFER`**: `dcontext='from-internal-xfer'`, `ANSWERED`, `billsec>0`; `from_op` = ext from `Local/<ext>@` or `SIP/<ext>-` of `channel`; `to_op = dst`; grouped by exact `channel` string, ordered by `calldate`.

### 4.3 Dashboard KPIs (`getSummaryStats`, `ami:2822-2898`)

`dbSummary = idb.cache.summary` (always present after the first 5 s sync). Fallbacks to AMI `stats` only if it is null.

| Output field | Definition | Ref |
|---|---|---|
| `inboundCalls` | `COUNT(DISTINCT uniqueid)` over `IN` | `idb:150`, `idb:295` |
| `answeredCalls` | `COUNT(DISTINCT uniqueid)` over `IN` with uniqueid ∈ `OPANS` (inbound only) | `idb:151`, `idb:313` |
| `outboundCalls` | count of `OUT` rows with `ANSWERED AND billsec>0` (rows, not distinct calls; unanswered outbound not counted anywhere) | `idb:181-182`, `idb:304` |
| `totalCalls` ("Jami" on the dashboard) | `inboundCalls + outboundCalls` | `idb:312` |
| `abandonedCalls` | `max(0, inboundCalls − answeredCalls)` — includes IVR-only hangups and any inbound not reaching an operator in 08–21 | `idb:315` |
| `abandonedPendingCalls` / `abandonedUnreachableCalls` / `abandonedResolvedCalls` | proportional split of `abandonedCalls` by today's callback counts (`round(abandoned × pending/totalCb)`, `round(abandoned × unreachable/totalCb)`, remainder); if no callbacks → all pending | `ami:2835-2848` |
| `callbacksPendingCount` / `callbacksUnreachableCount` / `callbacksResolvedCount`, `totalAbandonedClients` | from `db.getAbandonedBreakdown('today')` (§5.10) | `ami:2835-2836` |
| `deniedCalls` | Σ over ops of `COUNT(DISTINCT event_time)` in `operator_reject_events` today 08–21. Nothing writes this table any more (§7.2), so effectively 0 | `ami:2850-2852`, `db:309-332` |
| `missedCalls` | Σ over ops of `getTodayOperatorMissed` (agent logs, §4.6) | `ami:2854-2856` |
| `clientHangupCalls` / `operatorHangupCalls` | AMI `AgentComplete` counters since start/day change | `ami:2880-2881` |
| `totalDurationSec` | `in_talk_sec + out_talk_sec`; `in_talk_sec = SUM(DISTINCT talk_sec)` over the joined set (loses equal durations), `out_talk_sec = SUM(billsec)` of `OUT` ANSWERED rows | `idb:152`, `idb:183`, `idb:314` |
| `uniqueClients`, `inboundClients` | `COUNT(DISTINCT src)` over `IN` | `idb:154` |
| `answeredClients` | `COUNT(DISTINCT src)` over answered `IN` | `idb:155` |
| `outboundClients` | `COUNT(DISTINCT dst)` of answered `OUT` | `idb:184` |
| `totalClients` | `inUnique + outUnique` | `idb:353` |
| `missedClients` | `min(missedCalls, totalAbandonedClients || missedCalls)` | `ami:2877` |
| `answerRate` | `round(answered / totalCalls × 100)` — denominator includes outbound (the cached CDR summary uses `answered / inbound`, but `getSummaryStats` recomputes) | `ami:2882` vs `idb:331` |
| `abandonedRate` | `abandoned / inbound` | `ami:2883` |
| `outboundRate`, `denyRate`, `missedRate` | `/ totalCalls` | `ami:2884-2886` |
| `activeCount` | `activeChannels.size` (includes `Local;1` and operator legs) | `ami:2888` |
| `operatorCount` | `operators.size` | `ami:2889` |
| `queueClients`, `queueWaitingTotal` | `queueWaitingList.length` (§2.5) | `ami:2876`, `ami:2890` |
| `hourlyChart` | §4.7 | `ami:2891-2895` |
| `queueStrategy` | `getActiveQueueStrategy()` | `ami:2896` |

Past date (`/api/stats?date=`): `fetchFullStatsByDate` uses the same SQL with a date condition; `answeredClients = min(answered, inUnique)`; `missedCalls` re-read from SQLite on every request; live-only fields are 0 (`idb:1669-1894`).

### 4.4 Per-operator metrics

**CDR base (`idb.syncAllData` sections `OPERATORS`, `OP_OUTBOUND`, `XFER_ROWS`, `idb:219-258`, `idb:403-512`):**

| Field | Definition |
|---|---|
| `rawAnswered` | rows with `dst` = ext (`^[0-9]{2,4}$`), `src` not 1–4 digits, `ANSWERED AND billsec>0` (rows, not distinct calls) |
| transfer chains | per `XFER` chain (grouped by `channel`): every row → `xferOut[from]++`; every numeric `to` → `receipts[to]++`; first row's numeric `from` → `firstFrom[from]++`; last numeric `to` → `xferIn[lastTo]++` |
| `answered` (= "resolved inbound") | `max(0, rawAnswered − receipts − firstFrom)` |
| `outbound` | `OUT` rows from `SIP/<ext>-` with `ANSWERED AND billsec>0` |
| `transferredOut` | `xferOut` |
| `transferredIn` = `transferResolved` | `xferIn` (only the last operator in a chain gets +1) |
| `denied` | `operator_reject_events` count (effectively 0) |
| `totalCalls` | `answered + outbound + denied + transferResolved` |
| `totalDurationSec` | `SUM(billsec)` of ANSWERED `dst=ext` rows + outbound `SUM(billsec)` |
| `avgDurationSec` | `totalDurationSec / (answered + outbound + transferResolved)` |

Operators with outbound but no inbound rows get `answered=0` (`idb:491-512`). Past-date `fetchOperatorStats` (`idb:1161-1425`) uses `dst REGEXP '^[0-9]{3,4}$'` (today: `{2,4}`), adds every known name with zeros, and adds `missed` and `grandTotal = answered + outbound + transferResolved`.

**Agent base (`db.getTodayAgentOperatorStats`, `db:914-958`)** over `agent_3cx_call_logs` 00:00–23:59, only `LENGTH(caller_id) > 4`:
- `answered` = `event_type IN ('ANSWERED','2') AND duration_sec>0`
- `outbound` = `event_type IN ('DIALLED','1') AND duration_sec>0`
- `missed` = `event_type='MISSED' OR (duration_sec=0 AND event_type NOT IN ('DIALLED','1'))`
- `totalDurationSec` = Σ duration of answered + outbound; `avg = total/(answered+outbound)`.

**Merge for the main dashboard (every 15 s `ami:403-434`, then again on every `getOperatorList` `ami:2429-2448`):**

| Field | Value shown |
|---|---|
| `answered` | CDR `answered` (agent ignored); between syncs, +1 per AMI `AgentConnect` |
| `outbound` | `max(CDR outbound, agent outbound)` |
| `transferredIn/Out/Resolved` | CDR (`transferResolved` falls back to `max(0, in − out)` when 0, `ami:417`) |
| `totalDurationSec` | `max(CDR, agent)` |
| `avgDurationSec` | `totalDurationSec / (answered + outbound + transferResolved)` |
| `denied` | SQLite rejects (≈0) |
| `missed` | `getTodayOperatorMissed` (§4.6) |
| `grandTotal` | `answered + outbound + transferResolved` |
| `totalCalls` | `answered + outbound + denied` (no transfers) |
| `callsTaken` | §6.4 |

**`/operators` page (`agent_operators_update`, `getAgentOperatorStatsList`, `app:3622-3662`)** — agent-only numbers: `answered`, `outbound`, `missed`, `totalDurationSec`, `avgDurationSec` from agent logs; `transferResolved` from the live op (CDR); `grandTotal = ans + out + transferResolved`; `totalCalls = ans + out + missed + transferResolved`; `callsTaken` = raw Asterisk value.

**Past date `/api/agent/operator-stats?date=`** (`app:3681-3733`): for answered/outbound/missed/duration take the agent value if > 0, else CDR (preference, not max); transfers from CDR; same formulas as above.

**Past date `/api/operators?date=`** (`app:1738-1780`): CDR only (`fetchOperatorStats`), live presence/agent fields merged in.

### 4.5 "Jami" (total) — all variants

| # | Where | Formula | Ref |
|---|---|---|---|
| J1 | dashboard KPI `totalCalls` | inbound(all) + outbound(answered) | `idb:312` |
| J2 | CDR op stats `totalCalls` | resolvedIn + outbound + denied + transferResolved | `idb:476`, `idb:501`, `idb:1344`, `idb:1375` |
| J3 | CDR op stats `grandTotal` (past dates) | resolvedIn + outbound + transferResolved | `idb:1345`, `idb:1376` |
| J4 | live op `totalCalls` after 15 s sync | answered + max(out) + denied + transferResolved | `ami:432`, `ami:454` |
| J5 | `getOperatorList` `totalCalls` (what clients get) | answered + max(out) + denied | `ami:2443` |
| J6 | `getOperatorList` `grandTotal` | answered + max(out) + transferResolved | `ami:2440` |
| J7 | `/operators` `grandTotal` | agentAns + agentOut + transferResolved | `app:3632` |
| J8 | `/operators` `totalCalls` | agentAns + agentOut + agentMissed + transferResolved | `app:3659` |
| J9 | effective `callsTaken` (DB sync on) | J6 + manual offset | `ami:2692-2698` |
| J10 | Excel export | CDR `fetchOperatorStats` (for today = raw `idb.cache.operators`, no agent merge) | `exportService.js:263`, `:644` |

### 4.6 Answered / missed / rejected / abandoned / hangup party

| Concept | Implemented meanings |
|---|---|
| Answered (call level) | CDR: inbound uniqueid has an `OPANS` row. Call list (`fetchCallsPaginated`): has a 2–4 digit operator (or transfer) and (`final_disp='ANSWERED'` or `talk_sec>0`), where `final_disp` = ANSWERED if any row ANSWERED with billsec>0 (`idb:2051-2056`). AMI: AgentComplete always ANSWERED; Hangup rules in §3.3 |
| Answered (per op) | CDR `resolvedIn`; agent `ANSWERED/2` with duration > 0; AMI AgentConnect transient increment |
| Missed per op ("O'tkazib yuborilgan") | agent logs count (see §4.4 `missed`, window 08:00–21:00 `db:402-409`) + `operator_missed_events` only for ops with no agent count (`db:420-438`); nothing writes `operator_missed_events` any more |
| Rejected / denied | `operator_reject_events` (writer `recordOperatorReject` has no callers; `/api/agent/reject` is a no-op `app:3468-3470`). Comment `ami:1075-1079` explains AMI BUSY/RingNoAnswer is deliberately not used |
| Abandoned (KPI) | inbound − operator-answered (§4.3) |
| Abandoned (call list) | not answered and not outbound BUSY (`idb:2125`) |
| Abandoned (callback) | §5.4 |
| Client vs operator hangup | Only `AgentComplete.reason` is real (`agent` → operator, `caller`/other → client, `transfer` → neither). Elsewhere synthetic: AMI Hangup answered → outbound 'Operator' / inbound 'Mijoz tugatdi'; CDR list answered → always 'Mijoz', transfer → 'Transfer', outbound BUSY → 'Band', else "Ko'tarilmadi" (`idb:2092-2094`); call details answered → outbound 'Operator' / inbound 'Mijoz' (`idb:2376`) |

### 4.7 Talk time and waiting time

| Surface | Talk time | Waiting time |
|---|---|---|
| KPI `totalDurationSec` | §4.3 | — |
| Op `totalDurationSec` | §4.4 (max of CDR/agent) | — |
| AMI AgentComplete record | `talktime` | `holdtime` |
| AMI QueueCallerAbandon record | 0 | `holdtime` |
| AMI Hangup record | §3.3 duration chain | inbound `(now−start) − talk`; outbound 0 |
| CDR call list (`fetchCallsPaginated`, `idb:2096-2114`) | `MAX(billsec)` if answered else 0 | not answered: `max(MAX(duration), MAX(billsec))`; answered: `TIMESTAMPDIFF(MIN(calldate), MAX(answered calldate))` if > 0, else `MAX(duration) − MAX(billsec)`; still 0 → recording filename timestamp − calldate (0–3600 s); still 0, inbound, recording contains `q-` → `clamp(duration − billsec, 1, 60) || 12` |
| CDR call details (`fetchCallsDetail`, `idb:2432-2447`) | operator's own `billsec` if an operator filter is given, else `MAX(billsec)` | not answered: `max(wait, talk)`; answered with op: `ans_lag`; recording fallback; inbound queue still 0 → **8** |
| Live conversation timer | `op.talkingSince` / conversation `startTime` (§2.6) | queue `waitSec` from `QueueEntry.wait` (QueueCallerJoin starts at 0 and is not ticked) |

### 4.8 Hourly chart

Today: hours 8..21 (14 buckets), per `HOUR(calldate)`: inbound = `COUNT(DISTINCT uniqueid)` over `IN`; answered = distinct uniqueids ∈ `OPANS` (`idb:192-217`, `idb:362-384`). Because of `TIME <= '21:00:00'`, the 21:00 bucket only contains calls at exactly 21:00:00. `fetchHourlyStats` for past dates (only reachable through `fetchTodayHourlyStats` fallback) counts answered as ANSWERED rows (incl. IVR auto-answer) — a different definition (`idb:1460-1473`).

### 4.9 Call history lists and statuses

| List | Source | Status values |
|---|---|---|
| WS recent feed (`callHistory`) | AMI + 50 newest CDR (§2.7) | ANSWERED, ABANDONED, NO ANSWER, BUSY |
| `/api/history` | `fetchCallsPaginated` (CDR, 08–21, inbound contexts ∪ outbound `from-internal SIP/<ext>-`), per uniqueid; direction `transfer` if joined to an `XFER` chain by uniqueid or `channel` prefix before `;`; `outbound` if `is_out` or `src` ≤ 4 chars | ANSWERED, BUSY (outbound), ABANDONED |
| `/api/calls/recent` | same with `skipCount`; fallback last 7 days; fallback AMI `callHistory` | |
| `/api/calls/details?type=` | `fetchCallsDetail`: `denied` → `operator_reject_events`; `missed` → agent logs; `transferred`/`outbound`/`inbound`/`answered`/`abandoned`/`operator`/`all` → CDR filters (`idb:2234-2261`); today + types `operator/outbound/all` additionally merge agent-log calls not found in CDR (last 9 digits match within 3 min; may run `find` on the PBX for a recording) (`idb:2468-2563`) | ANSWERED, ABANDONED, DENIED, NO ANSWER, MISSED |

Note `type=answered` there counts any ANSWERED inbound row (incl. IVR answers), unlike the KPI.

---

## 5. Callbacks (`pending_callbacks`)

### 5.1 Table

Schema `db:134-151` + migrations `db:186-203`:

| Column | Meaning |
|---|---|
| `id` | PK |
| `phone` | normalized number (§5.2) |
| `caller_name` | never set by telephony code (upsert passes `''`) |
| `source` | `abandoned` \| `ivr_non_working` (`manual` in the schema comment, never written) |
| `call_time` | Tashkent `YYYY-MM-DD HH:MM:SS` of the latest missed call |
| `attempts_count`, `today_attempts` | client call attempts (§5.5) |
| `status` | `pending` \| `resolved` \| `dismissed` |
| `dismissed_at`, `dismissed_by` | set by **both** resolve and dismiss; `dismissed_at` = SQLite `datetime('now','localtime')` (server TZ); `dismissed_by` = resolver key (`operator_103_inbound`, `3cx_answered_103`, …) or actor name |
| `outbound_attempts`, `last_outbound_time`, `last_outbound_operator`, `last_outbound_cause` | failed callback attempts by operators; `last_outbound_operator` is also overwritten with the **resolving** operator on resolve |
| `resolution_type` | `operator_outbound` \| `client_inbound` \| NULL |
| `notes` | unused |
| `created_at`, `updated_at` | `datetime('now','localtime')` (server TZ) |

On every startup rows with `phone LIKE '%2020159%'`, `='712020159'`, length < 7 or > 12 are deleted regardless of status (`db:216-225`).

UI categories (derived): **Kutilmoqda** = pending & `outbound_attempts = 0`; **Bog'lanib bo'lmadi** = pending & `outbound_attempts > 0`; **Gaplashildi** = resolved.

### 5.2 Number normalization (several, inconsistent)

| Function | Rule | Used for |
|---|---|---|
| `db.normalizePhone` (`db:1089-1104`) | digits only; 12 digits starting `998` → last 9; reject length < 7 or > 12; reject `2020159`, `712020159`, `*2020159` | callbacks keys, resolve/upsert/failed attempts, active-phone set |
| `ami.getMatchablePhone9` (`ami:188-192`) | last 9 digits if ≥ 9 | active-call lookup for a callback |
| `ami.extractCallerNumber` (`ami:668-685`) | §2.13 (may keep `998`) | caller from AMI fields |
| `db.cleanContactPhone` (`db:1596-1603`) | digits; 12-digit `998…` → 9 | contacts |
| `bl.normalizeNumber` (`bl:53-81`) | digits; ≥3; 10 digits starting `8` → drop `8`; 9 → `[9, 998+9]`; 12 `998…` → `[9, 12]` | blacklist |
| `sync.cleanPhone` (`sync:112-116`) | last 9 if ≥ 9 | CDR→agent dedupe |
| call-details merge (`idb:2491`, `idb:2497`) | last 9 digits, plus suffix match | CDR/agent merge |

Numbers like `0901234567` (10 digits) stay 10 digits in `normalizePhone` and do not match a stored 9-digit key on upsert (they do on resolve, via `LIKE`).

### 5.3 Working-hours rules

- `db.isWorkingHours(d)` (`db:233-246`): with an argument → `new Date(d)` hours/minutes in the **server** timezone; without → current Tashkent wall clock. True when `08:00 ≤ hh:mm ≤ 21:00` (i.e. through 21:00:59). No weekday or holiday rule anywhere in telephony code.
- CDR callback classification (`idb:707-713`): `ivr_non_working` if the latest non-`from-internal` row's `lastdata` matches `working-time|music-working-time` (the IVR/announcement played by the PBX time condition) or its time is < 08:00:00 or > 21:00:00; else `abandoned`.
- AMI QueueCallerAbandon: always `abandoned` (no time check). AMI Hangup: `isWorkingHours(callStartTime)`.
- `ivr_non_working` rows are excluded from **every** list and count (`db:1128`), i.e. stored but invisible.

### 5.4 Creation sources

| Source | Condition | `source` | Attempts | Ref |
|---|---|---|---|---|
| AMI `QueueCallerAbandon` (B) | caller number not hidden and normalizes | `abandoned` | default (1) | `ami:1527-1537` |
| AMI `Hangup` of trunk channel | inbound, not answered (§3.3), trunk channel, caller not in any active call, no ANSWERED inbound in history for this number within 90 s, not already in history | `abandoned` / `ivr_non_working` by `isWorkingHours` | default (1) | `ami:1941-1962` |
| CDR sync phase 2 (every 15 s, 2/30-day window; `POST /api/callbacks/sync?days=N`) | phone's missed calls (below) with no later operator conversation, and phone not currently active | SQL classification (§5.3) | `attempts = COUNT(DISTINCT channel)` in window, `today = COUNT(DISTINCT channel)` today | `idb:676-852` |

CDR "missed call" set (`idb:699-737`): `IN`-style rows in the window with `src REGEXP '^[0-9]{7,12}$'`, not trunk, whose uniqueid is not in `OPANS` **and** whose `channel` has no `ANSWERED AND billsec>0` row at all; grouped per channel (first calldate), then per phone (`MAX` time), newest 250 phones. "Later conversation" = the phone's entry in the answered map (§5.8) has an operator and a time ≥ the missed time → resolve instead of upsert; if nothing was pending, nothing is created.

Not a creation source: desktop-agent MISSED events, DialEnd/AgentRingNoAnswer, outbound failures.

### 5.5 `upsertCallback` (`db:1281-1378`)

Input `{phone, callerName='', source='abandoned', callTime=nowTashkent, attemptsCount=1, todayAttempts=null}`.

1. Normalize; invalid → null.
2. If a `pending` row exists for the phone (latest id):
   - `isNewCall = callTime > row.call_time` (string compare).
   - `attempts_count` = `attemptsCount` (always an integer — the default is 1, so AMI calls set it to 1) — the "+1 on new call" branch is unreachable.
   - `today_attempts` = `todayAttempts` if given, else +1 if new call today, else unchanged.
   - `call_time` = max(existing, new); `source` = **new source (overwrites)**; `caller_name` kept unless a non-empty one is given; `outbound_attempts` reset to 0 if `isNewCall`.
3. Else look at the latest row for the phone:
   - `dismissed`: skip if `callTime <= call_time` or `callTime <= dismissed_at` (or `updated_at`).
   - `resolved`: skip if `callTime <= call_time` or `callTime <= updated_at`.
4. Insert a new `pending` row (`today_attempts` = given, else `attemptsCount` if today else 0; `outbound_attempts = 0`).

### 5.6 Resolution

`resolveCallback(phone, resolvedBy, operatorName, resolutionType)` (`db:1384-1465`):
- operator display: given name, else the ext parsed from `operator_<ext>` / `3cx_*_<ext>` in `resolvedBy`, mapped through `KNOWN_OPERATORS` to `Name (ext)`.
- type: given; else `operator_outbound` if `resolvedBy` contains `outbound` (or is `realtime_outbound_bridge`), `client_inbound` if it contains `inbound` (or `realtime_agent_connect`), else NULL.
- `UPDATE … SET status='resolved', dismissed_at=now(local), dismissed_by=resolvedBy, last_outbound_operator=<op or keep>, resolution_type=COALESCE(type, …) WHERE (phone = clean OR phone = '998'||clean OR phone = raw OR phone LIKE '%clean%') AND status='pending'` — all matching pending rows.
- Also back-fills operator/type on already-resolved rows matching the same predicate.
- Returns true if any pending row changed.

| Resolver | When | `resolvedBy` / type | Ref |
|---|---|---|---|
| AMI `AgentConnect` (B) | operator picks up a queue call (no talk-time requirement) | `operator_<ext>_inbound` / client_inbound | `ami:1482-1487` |
| AMI `BridgeEnter`/`Bridge` | outbound channel with dialed number bridged | `operator_<ext>_outbound` / operator_outbound | `ami:1777-1784` |
| AMI `Hangup` | answered (§3.3) with op | `operator_<ext>_<type>` | `ami:1935-1940` |
| Agent `ANSWERED` / `ENDED` with `durationSec > 0` | | `3cx_answered_<ext>` / `3cx_ended_<ext>`, type NULL | `app:3769-3778` |
| Agent `DIALLED`/`OUTBOUND` with `durationSec > 0` | | `3cx_outbound_<ext>` / operator_outbound | `app:3779-3781` |
| CDR sync phase 1 (all pending, 3-day answered map) | answered time ≥ `call_time` and operator known | `operator_<ext>_<dir>` | `idb:644-653` |
| CDR sync phase 2 | per missed phone, answered after the missed time | same | `idb:819-835` |
| CDR sync phase 3 (today's pending) | same check with the window's answered map | same | `idb:857-876` |

`sync-batch` uploads from the agent never resolve callbacks.

### 5.7 Failed callback attempts (`recordFailedOutboundAttempt`, `db:1472-1530`)

Only updates the latest **pending** row matched by the same `= / 998 / raw / LIKE '%clean%'` predicate; no pending row → no-op.
- `attempts` given (CDR) → `max(attempts, current, 1)`; else `current + 1`, unless the previous attempt was < 20 s earlier (then unchanged).
- cause mapping: contains `busy` or `17` → "Mijoz band"; `no answer`/`no user`/`failed`/`18`/`19` → "Javob bermadi"; `reject`/`21` → "Rad etildi"; `absent`/`unavail`/`20` → "Aloqa doirasidan tashqarida"; default "Javob bermadi".
- sets `last_outbound_time/operator/cause`, `updated_at`.

Callers: AMI DialEnd non-ANSWER for the tracked outbound (`cause = dialstatus`), AMI Hangup outbound not answered (`cause = Hangup cause code`), agent `DIALLED/OUTBOUND` with `durationSec === 0` (cause "Javob bermadi", time = agent `startTime`), CDR sync phase 1 (latest failed outbound to the phone in 3 days, at/after `call_time`; `attempts = COUNT(*)` of **all** failed attempts in 3 days).

### 5.8 CDR sync (`syncPendingCallbacks(days, activePhones)`, `idb:529-886`)

Called every 15 s from `ami.syncIssabelData` (days = 30 every 30 min, else 2; `activePhones` = `getActiveCallerPhones()`), and by `POST /api/callbacks/sync` (no active-phone filter).

1. **Phase 1** — if any pending: build the *answered map* over 3 days and the *failed-outbound map* over 3 days; for each pending: resolve if answered after `call_time` with an operator, else record failed attempts.
2. **Phase 2** — missed-call query (§5.4) + answered map over `days`; per phone: resolve, or (if not active) upsert.
3. **Phase 3** — today's pending: permanently delete rows with invalid phones; resolve those answered after `call_time` using phase 2's map.

*Answered map* SQL (`idb:539-569`, `idb:744-776`): rows `ANSWERED AND billsec>0` where `src` or `dst` is a ≥7-digit non-trunk number; `phone` = `src` if `dst` is short/an extension, else `dst` (≥7), else `src`; `GROUP BY phone` with `MAX(calldate)`, `direction` from non-aggregated columns (MariaDB picks an arbitrary row), and `op_ext` = operator of the newest row for which an operator can be parsed. Time and operator can therefore come from different calls (§8 B19). Entries without an operator are ignored.

### 5.9 Dismissal and deletion

| Endpoint | Behavior | Ref |
|---|---|---|
| `DELETE /api/callbacks/:id` | `status='dismissed'`, `dismissed_at/by` (actor) for that id **and every pending row with the same phone** | `app:2498-2515`, `db:1535-1555` |
| `DELETE /api/callbacks` | dismiss all pending | `app:2518-2532`, `db:1560-1577` |
| (internal) phase 3 | hard delete of invalid-phone pending rows | `idb:862-865` |

No role check beyond being logged in; no reason captured. A dismissed number reappears only for a missed call strictly after both its `call_time` and `dismissed_at`.

### 5.10 Lists, filters and counters

`db.getCallbacks(filter, includeResolved)` (`db:1119-1253`):
- Base filter: `phone NOT LIKE '%2020159%'`, `≠ '712020159'`, length ≥ 7, `source != 'ivr_non_working'`.
- `filter`: `all` | `today` (Tashkent) | `YYYY-MM-DD`. Pending match `call_time LIKE d% OR created_at LIKE d%`; resolved match `call_time LIKE d% OR dismissed_at LIKE d%`.
- Pending ordering: `outbound_attempts = 0` first, then `call_time DESC`, then `updated_at/created_at DESC`; limit 500. Resolved: `dismissed_at/updated_at/call_time DESC`, limit 300. Dismissed rows are never listed.
- Grouping: pending by phone (one row per phone; `attempts_count` = max, `today_attempts` = max over today's rows, `call_time` = max); resolved by phone + call date.
- `getPendingCallbacks(filter)` = pending only.
- `getAbandonedBreakdown(date)` = rows of `getCallbacks(date, true)` with `source='abandoned'` → pending (0 outbound attempts), unreachable (>0), resolved (`db:1258-1273`).
- API: `GET /api/callbacks?filter=` → `getCallbacksWithActiveCalls(filter)` (includes resolved) (`app:2487-2495`). WS `callbacks_update` always sends `filter='all'`.

### 5.11 "In a call right now" annotation

`getCallbacksWithActiveCalls` adds `activeCall` per row via `getActiveCallByPhone` (`ami:194-308`), matching the last 9 digits against, in order: `activeConversations` (talking), ops ringing with `ringingCaller`, `activeChannels` with an operator, then `agentActiveCalls` (≤45 s for RINGING). Entries whose operator is not "online" (valid SIP IP or agent connected) are skipped. Returns `{operator, operatorExten, state: talking|ringing, stateLabel, direction, duration}`.

`getActiveCallerPhones` (`ami:310-341`) collects normalized numbers from the same sources (excluding the trunk) and suppresses CDR callback creation for those numbers.

---

## 6. Actions

All are plain authenticated routes (any logged-in role; no per-action authorization).

### 6.1 Telephony actions

| Action | Route | Exact command | Side effects | Ref |
|---|---|---|---|---|
| Pause / unpause | `POST /api/operator/pause {extension, paused}` | SSH: `asterisk -rx "queue pause member Local/<ext>@from-queue/n"` or `unpause` (ext = digits of input; no queue name → all queues; no reason) | memory: `paused`, presence paused/ready; broadcast `operators_update`. CLI failure is not detected (exit code 0, 10 s timeout resolves `''`) | `app:3420-3463` |
| Transfer | `POST /api/action/transfer {channel, targetExten}` | AMI `Redirect {Channel: channel, Exten: targetExten, Context: 'from-internal', Priority: 1}` (no `ExtraChannel`) | none; result relayed | `app:3218-3231`, `ami:2801-2814` |
| Hangup | `POST /api/action/hangup {channel}` | AMI `Hangup {Channel}` | removes the channel from `activeChannels`/`channelToOperator` first and recalculates | `app:3234-3253` |
| Click-to-call | `POST /api/action/originate {from, to}` | AMI `Originate {Channel: 'SIP/<from>', Exten: to, Context: 'from-internal', Priority: 1, CallerID: from}` (synchronous, no `Async`) | pre-creates `operatorOutboundCalls[from]` and sets the op `ringing` `📤 to` | `app:3256-3291` |
| Midnight queue reset | (timer) | AMI `Command: queue reset stats` (all queues) | | `ami:2613-2627` |
| Refresh | WS `{action:'refresh_channels'}` | `CoreShowChannels`, `QueueStatus`, `SIPpeers` | | `app:1585-1586` |

No input validation of `channel`, `targetExten`, `from`, `to` beyond presence.

### 6.2 Blacklist (operator 114 only)

Password: env `BLACKLIST_ADMIN_PASSWORD` (empty → always denied), compared with `safeEqual`, accepted from `x-blacklist-auth`, `Authorization`, `?password=` or body `password` (`bl:36-40`, `app:3369-3379`).

| Route | Behavior | Ref |
|---|---|---|
| `POST /api/blacklist/verify` | password check | `app:3360-3366` |
| `GET /api/blacklist` | first imports AstDB: SSH `asterisk -rx "database show blacklist_114"`, parse `/blacklist_114/<num> : <note>` → `INSERT OR IGNORE` into SQLite `blacklist` (note default `Asterisk 114`); then list SQLite | `bl:86-147` |
| `POST /api/blacklist {number, note}` | normalize (§5.2) → upsert SQLite `blacklist(number=primary, variants JSON, note)`; for each variant (`^[0-9]{3,15}$`): `asterisk -rx 'database put blacklist_114 <v> "<note>"'; asterisk -rx 'database del blacklist <v>'` | `bl:152-195` |
| `DELETE /api/blacklist/:number` | delete from SQLite; for each variant: `database del blacklist_114 <v>` and `database del blacklist <v>` | `bl:200-234` |

Semantics: AstDB family `blacklist_114` is consulted by PBX dialplan (not in this repo) so that blocked numbers are not routed to 114 but still reach other operators; adding a number **removes** it from the global FreePBX `blacklist` family (unblocking it for everyone else). AstDB note is stripped to `[\p{L}\p{N} _.,:()-]`, fallback `1`. `primary` is the 12-digit `998…` form for 9-digit input.

### 6.3 Callbacks admin

See §5.9 and `POST /api/callbacks/sync?days=N` (default 30).

### 6.4 Queue `callsTaken` adjust and DB sync settings

| Route | Behavior | Ref |
|---|---|---|
| `GET /api/queue/sync-settings` | `{enabled: queueDbSyncEnabled, mode: 'grandTotal'}` | `app:3322-3328` |
| `POST /api/queue/sync-settings {enabled}` | set + persist + broadcast `operators_update` | `app:3330-3342`, `ami:2558-2564` |
| `POST /api/queue/adjust-calls {operatorId, delta=1, value?, reset?}` | `reset` → delete override; else `adjustOperatorCallsTaken(op, delta, value)` | `app:3295-3319` |
| `POST /api/queue/sync-now` | `syncAllFromDbNow()` | `app:3344-3355` |

Rules (`ami:2687-2777`):
- `base` = DB sync on: `answered + max(outbound, agentOutbound) + transferResolved`; off: raw Asterisk `callsTaken`.
- effective (`getEffectiveCallsTaken`): on → `max(0, grandTotal + offset)`; off → `max(0, raw + offset)` if an override exists, else raw.
- adjust: target = `max(0, value)` if `value` given, else `max(0, effective + delta)`; `offset = target − base`; offset 0 deletes the key; persisted; broadcast.
- `syncAllFromDbNow`: for every op `offset = dbTotal − rawCallsTaken` (relative to the raw value even when DB sync is on).
- Midnight: overrides cleared, `callsTaken` zeroed, `queue reset stats`.
- None of this is sent to Asterisk; the queue's `fewestcalls`/`rrmemory` routing still uses Asterisk's own counters. The numbers are display-only.

---

## 7. 3CX Desktop Agent integration (`/api/agent/*`)

### 7.1 Transport and auth

- Open paths (no session): `heartbeat`, `call-event`, `sync-batch`, `version`, `update-log`, `reject` (`app:1087`, `app:1167-1173`). If `AGENT_API_KEY` is set, `x-agent-key` must match; otherwise anyone on the network can post (`app:1095-1099`).
- Sanitizer middleware (`app:1095-1138`): `operatorId` must be 2–6 digits; `eventType` cleaned + **upper-cased**; `callerId` restricted to letters/digits/space/`+()*#.-` (≤40); `hostname`, `details`, times cleaned/truncated; batches ≤ 20 000 items.
- Agents may also hit port 3000; a compat listener forwards `/api/agent/*` when `PORT ≠ 3000` (`app:4036-4060`). HTTPS redirect is skipped for `/api/agent/*` (`app:326-328`).

### 7.2 Endpoints

| Endpoint | Behavior | Ref |
|---|---|---|
| `POST heartbeat {operatorId, hostname, appVersion\|version}` | ensure op; `agentConnected=true`, `lastAgentPing=now`, hostname, version; on offline→online broadcast `operators_update` + `agent_operators_update`; reply `{latestVersion, updateUrl}` for OTA | `app:3490-3522` |
| `POST call-event {operatorId, eventType, callerId, durationSec, startTime, endTime, hostname, details}` | §7.3 | `app:3743-3807` |
| `POST sync-batch {operatorId, hostname, calls[]}` | `recordAgentCallLogsBatch`: `ANSWERED` with duration 0 → stored as `MISSED` (details text rewritten); MISSED within 90 s of another MISSED for same op+caller skipped; `INSERT OR IGNORE` on `(operator_id, caller_id, start_time)`; broadcasts if inserted. No callback effects | `app:3810-3828`, `db:849-908` |
| `POST reject` | no-op `{success:true, message:'Reject monitoring disabled'}` | `app:3468-3470` |
| `GET version`, `POST release`, `POST update-log`, `GET update-logs`, `GET status-all` | OTA version announcement (in-memory, default from `3cx-desktop-agent/dist/version.txt` or `1.0.4`), update log ring buffer (100), status table | `app:3473-3619` |
| `GET operator-stats?date=` | §4.4 `/operators` numbers | `app:3678-3740` |
| `GET logs` | paginated `agent_3cx_call_logs` with display mapping (`REJECT`→Rad etilgan; `MISSED`; `ANSWERED` with 0 s → MISSED; `OUTBOUND`/`DIALLED`; `INCOMING` 0 s → MISSED else ANSWERED) | `app:3831-3840`, `db:963-1084` |
| `POST sync-from-cdr {date}`, `GET sync-status` | run CDR → agent backfill (§7.4) | `app:3843-3860` |

### 7.3 Call-event semantics

Every event (any type) is first written to `agent_3cx_call_logs` via `recordAgentCallLog` (`db:795-844`): `event_time = startTime` (slashes → dashes) or now (Tashkent); MISSED within 90 s of a previous MISSED for the same op+caller is dropped; if `details` is non-empty and an identical `(op, caller, details)` row exists it is skipped; `INSERT OR IGNORE` on the unique index `(operator_id, caller_id, start_time)` (`db:120`).

| `eventType` | Extra effect |
|---|---|
| `RINGING` | `agentActiveCalls[op] = RINGING` (callback "ringing" badge). Row stored with duration 0 → counted as **missed** by the missed formula |
| `ANSWERED` | if `durationSec > 0`: resolve callbacks (`3cx_answered_<op>`); `agentActiveCalls[op] = ANSWERED` |
| `ENDED` | if `durationSec > 0`: resolve callbacks (`3cx_ended_<op>`); `agentActiveCalls` delete |
| `MISSED` | log only; `agentActiveCalls` delete |
| `DIALLED` / `OUTBOUND` | `durationSec > 0` → resolve (`3cx_outbound_<op>`); `durationSec === 0` → failed callback attempt |
| others (`INFO`, `INCOMING`, `REJECT`, `'1'`, `'2'`, …) | log only |

Then broadcast `agent_operators_update`, `stats_update`, and `callbacks_update` for the main types.

Effect on stats (by reading the log table): per-op `missed` (dashboard and `/operators`), `outbound` and `totalDurationSec` via `max()` on the dashboard, all `/operators` numbers, the effective `callsTaken` when DB sync is on, the extra rows in `/api/calls/details`, and `top-active` clients fallback. Agent connectivity affects only `agentConnected` and the "online" test for callback active-call badges — not the presence shown on operator cards (§2.2.2).

### 7.4 CDR → agent-log backfill (`sync.syncDailyCdrToAgentLogs`, `sync:80-278`)

- When: 21:00 Tashkent daily, every quarter hour, and `POST /api/agent/sync-from-cdr`.
- Reads CDR for the date between `08:00:00` and `21:00:00`: inbound = `dst` 2–4 digits, `dcontext != 'from-internal-xfer'`, `ANSWERED AND billsec>0`; outbound = `from-internal`, `SIP/<ext>-`, (`dstchannel LIKE 'SIP/%'` or `LENGTH(dst) ≥ 7`), `ANSWERED AND billsec>0`.
- A CDR call is skipped if an agent row exists for the same operator with a phone match (last 9 digits, empty matches anything, substring either way) within ±120 s (epoch computed as `+05:00`), regardless of that row's event type.
- Inserts `ANSWERED` / `DIALLED` rows with `hostname='Asterisk PBX'` and details `3CX … (Asterisk CDR sinxron)`.
- Consequence: the "agent" numbers become CDR ∪ agent over time, so `max(CDR, agent)` is effectively the agent-log value after each backfill.

---

## 8. Known bugs and questionable rules

V = verified by code reading; S = suspected (needs live data, §10). Severity: H affects management numbers or citizen callbacks; M visible inconsistency; L cosmetic/perf.

| ID | Sev | Status | Issue | Where | Suggested correct rule |
|---|---|---|---|---|---|
| B1 | H | V | No weekday/holiday rule: Sat/Sun calls count as working-hours in KPIs, callbacks and source classification | `db:233-246`; SQL `TIME()` filters e.g. `idb:173`, `idb:707-713` | One `WorkingCalendar` (weekdays, hours, holidays, `Asia/Tashkent`) used by live logic and to generate SQL windows |
| B2 | H | V (mechanism) / S (impact) | `isWorkingHours(Date)` uses the server timezone; Hangup passes a `Date` | `db:236-241`, `ami:1954` | Convert to Tashkent wall clock explicitly (Intl/Temporal); never depend on host TZ |
| B3 | M | V | End-of-day boundaries disagree: JS ≤ 21:00:59, SQL `TIME <= '21:00:00'`, agent stats 00–24, missed 08–21; hourly bucket 21 holds only `21:00:00` | `db:245`, `idb:173`, `db:917-918`, `db:409` | Half-open `[08:00, 21:00)` everywhere; one window for all sources |
| B4 | H | V / S | SQLite `datetime('now','localtime')` (server TZ) compared as strings with Tashkent times (dismiss/resolve guards, `created_at`/`dismissed_at` date filters) | `db:1146-1148`, `db:1350-1358`, `db:1430`, `db:1188` | Store UTC instants; compare instants; format Tashkent only at the edge |
| B5 | M | S | CDR uses PBX `CURDATE()`/`calldate` (PBX TZ); Node uses Tashkent — mismatch if PBX TZ differs | `idb:162`, `idb:172`, … | Query with explicit Tashkent date bounds computed in the app |
| B6 | H | V | Callback matching `phone LIKE '%<7–12 digits>%'` — a 7-digit landline closes other numbers' callbacks; failed attempts can land on the wrong record | `db:1439`, `db:1454`, `db:1483` | Exact match on one canonical form (E.164 `998XXXXXXXXX`) |
| B7 | H | V | `upsertCallback` overwrites `source` of an existing pending row; a later off-hours call turns `abandoned` into `ivr_non_working`, which is hidden from all lists | `db:1327`, `db:1128` | Keep earliest/most-severe source or a set of sources; never hide pending work |
| B8 | M | V | `ivr_non_working` callbacks are stored but excluded from every list and count | `db:1128` | Decide: show as separate tab (e.g. "after-hours") or don't create them |
| B9 | M | V | `attempts_count`: default `attemptsCount=1` makes AMI upserts reset it to 1 (increment branch unreachable); CDR sync alternates 2-day and 30-day `COUNT(DISTINCT channel)` so the value oscillates | `db:1281`, `db:1306-1310`, `ami:518-525`, `idb:705` | Count attempts from an event table (one row per missed call) since the callback opened |
| B10 | H | V (logic) / S (frequency) | DialBegin (B) binds the **caller** channel to the rung operator; Hangup treats `channelToOperator.has(channel)` as answered → an inbound call that left the queue without `QueueCallerAbandon` (timeout, IVR exit) is saved as ANSWERED for the last-rung operator and its callback is resolved instead of created | `ami:1301-1304`, `ami:1311-1315`, `ami:1885` (contrast `ami:1055-1056`) | Inbound answered only on AgentConnect / bridge with an operator leg (or CDR `OPANS`) |
| B11 | H | S | Possible double recording of answered queue calls: AgentComplete saves a record with a random id keyed to the caller channel; the operator leg's Hangup (`SIP/<ext>-…`) is not de-duplicated (dedupe only by channel/uniqueid/outbound rule) → second `calls` row and second `operator_daily_stats` increment | `ami:1264-1283`, `ami:1863-1867`, `db:588` | Assemble one call record per `linkedid`; idempotent insert by `linkedid` |
| B12 | M | V | Outbound two-leg dedupe compares **start** time to now within 60 s → calls longer than 60 s are recorded twice; also parses Tashkent string in server TZ | `ami:1866` | De-duplicate by `linkedid` |
| B13 | M | V | Hangup dedupe depends on `callHistory`, which the 15 s sync replaces keeping only AMI records newer than the newest CDR call | `ami:500-507`, `ami:1863` | Dedupe in the store (unique key), not in a display buffer |
| B14 | H | V | `SUM(DISTINCT talk_sec)` drops calls with equal durations → total talk time understated | `idb:152`, `idb:1544`, `idb:1702` | Sum per-uniqueid talk in a derived table, then `SUM` without `DISTINCT` |
| B15 | M | V | `answerRate` = answered inbound / (inbound + answered outbound) on the dashboard, but answered/inbound in the CDR cache | `ami:2882`, `idb:331` | answerRate = answered inbound / offered inbound |
| B16 | M | V | `outboundCalls` counts only answered outbound rows; unanswered outbound attempts appear in no KPI; "Jami" = all inbound + answered outbound | `idb:181-182`, `idb:304`, `idb:312` | Define outbound attempts and connected outbound separately; document Jami |
| B17 | M | V | `abandoned` = inbound − operator-answered (includes IVR-only, short hang-ups); pending/unreachable/resolved split is a proportional estimate, not a count | `idb:315`, `idb:320-329`, `ami:2840-2848` | Count abandoned by queue entry; split by joining actual callback rows |
| B18 | H | V (divergence) / S (impact) | Callback "missed" set additionally excludes channels with **any** answered row (`op_chan`). If the trunk leg is answered by IVR/queue (ANSWERED, billsec>0), CDR sync would never create callbacks; definition differs from the KPI | `idb:691-697`, `idb:723`, `idb:731` | Missed = queue/inbound call with no operator-answered leg (same definition as KPI) |
| B19 | H | V (SQL) / S (impact) | Answered map per phone mixes calls: `MAX(calldate)` of any answered row (incl. IVR auto-answer, possibly the missed call itself) + operator of the newest row having one + non-aggregated `direction` → a missed call can be "resolved" by an older conversation | `idb:540-569`, `idb:746-775`, `idb:817` | Per call: find an operator-answered call (same caller, after the missed call), take its own operator/direction |
| B20 | L | V | CDR failed-attempt count uses all 3-day failures, not only those after the missed call | `idb:601-617`, `idb:659-665` | Count attempts after `call_time` |
| B21 | H | V | "Jami" has ≥10 formulas (§4.5); dashboard, `/operators`, Excel and callsTaken disagree | §4.5 | One definition, one implementation, used by all views |
| B22 | H | V | Per-op numbers use `max(CDR, agent)`; agent data is unauthenticated, covers 00–24 vs CDR 08–21, and is backfilled from CDR (so it is ≥ CDR); past dates use "agent if > 0 else CDR" | `ami:408`, `ami:418`, `ami:2435`, `ami:2446`, `app:3694-3700`, `sync:80-278` | Choose CDR as the source of truth for counts; use agent data only for things CDR lacks (ring-no-answer per operator), with authentication |
| B23 | H | V (SQL) / S (impact) | Per-op `missed` counts every 0-second non-outbound agent event (`RINGING`, `ENDED`, `INFO`, `INCOMING`, `REJECT`), and `call-event` stores `RINGING` rows → likely inflation | `db:405`, `db:929`, `db:525`, `app:3754-3763` | Missed = explicit `MISSED` (queue ring not answered) de-duplicated per call |
| B24 | M | V | Denied/rejected is dead (no writer; `/api/agent/reject` no-op) but still part of `totalCalls`, `denyRate`, the `denied` drill-down | `app:3468-3470`, `db:251-302`, `ami:2852` | Remove, or re-implement from a reliable signal |
| B25 | M | V | `sync-now` sets `offset = dbTotal − raw`, but with DB sync on the offset is added to `grandTotal` → shows `2·dbTotal − raw` | `ami:2632-2641` vs `ami:2692-2698` | With DB sync on, "sync now" = clear overrides |
| B26 | M | V | `callsTaken` adjust is display-only: nothing is written to Asterisk, so queue routing is unaffected (contrary to the UI label and to the 2026-11-17 review) | `ami:2733-2777` | Decide: drop the feature, or implement real routing control (penalties / member state) with audit |
| B27 | L | V | `ExtensionStatus` −1 goes to the ringing branch (`-1 & 8` is 8) | `ami:898`, `ami:915` | Check `status < 0` first; map hint states explicitly |
| B28 | L | V | `PeerEntry` treats `UNREACHABLE` as online (`includes('REACHABLE')`); masked by `getOperatorList` | `ami:696` | Parse `OK`/`LAGGED`/`UNREACHABLE`/`UNKNOWN` explicitly |
| B29 | L | V | `PeerStatus` registration overwrites `ringing`; `PeerEntry` protects it | `ami:733` vs `ami:705` | Registration only toggles online/offline, not call state |
| B30 | L | V | `CoreShowChannel` rebuild drops `pairedChannel` every 5 s | `ami:1625-1639` | Merge, don't replace |
| B31 | L | V | Generic Dial block also runs on `DialState`/`DialEnd`, recreating the outbound entry (resets `startTime`, drops `answeredTime`) | `ami:1014`, `ami:1032-1038` | Handle DialBegin/DialEnd once each |
| B32 | L | V | Hangup early `return`s skip cleanup (binding leak, op presence not reset until next poll) | `ami:1851-1853`, `ami:1871-1873` | Always run cleanup (finally) |
| B33 | L | V | Delayed 5 s outbound deletion by op id can delete a new outbound started within 5 s | `ami:1991-2003` | Delete by call id |
| B34 | L | S | Hangup reads `evt.billsec`/`evt.duration`, which AMI `Hangup` does not carry → dead branches | `ami:1878-1879` | Use bridge timestamps or CDR/CEL |
| B35 | M | V | Hangup party is synthetic except for `AgentComplete`; AMI counters are in RAM and lost on restart | `ami:1918`, `idb:2092-2094`, `idb:2376`, `ami:40-41` | Persist hangup side from `AgentComplete.reason` / CEL `HANGUP` per call |
| B36 | M | V | `QueueCallerAbandon` creates callbacks without the working-hours/active-call checks the Hangup path applies | `ami:1527-1537` vs `ami:1944-1962` | Single creation function with one rule set |
| B37 | M | S | App listens to `disconnect`; `asterisk-manager` may only emit `close`/`end` → `isConnected` may stay true after a drop | `ami:576` | Track connection via library close/end + login response; use a maintained client |
| B38 | M | V | `Originate` is synchronous (HTTP waits for the operator to answer) and unvalidated (`to` any number, `from` any channel) | `app:3280-3287` | `Async: true`, validate `from` ∈ caller's own extension, `to` against allowed patterns |
| B39 | M | V | Pause uses SSH CLI across all queues, no reason, failures invisible | `app:3432-3433`, `idb:982-988` | AMI `QueuePause {Interface, Paused, Queue, Reason}` and check the response |
| B40 | M | V | Excluded operators are not applied to SQLite-derived stats or the CDR→agent backfill (separate empty Sets) | `db:10`, `sync:14` | One exclusion source injected everywhere |
| B41 | M | V | Historical vs today inconsistencies: `/api/db/summary` has no 08–21 filter; past `fetchOperatorStats` uses `dst {3,4}` vs today `{2,4}`; Excel today uses raw CDR cache without the agent merge | `idb:1563-1578`, `idb:1213` vs `idb:227`, `exportService.js:644` | Same query/definition for any date |
| B42 | M | S | Transfer chains grouped by exact `channel` string; a multi-hop transfer where the transferor's channel changes splits into two chains (middle operator credited as resolver) | `idb:411-441` | Group by `linkedid`; order by time; last operator leg with talk time resolves |
| B43 | L | S | `extractCallerNumber` can return a channel-id suffix (e.g. `00123456`) for hidden callers | `ami:676-681` | Only read caller-ID fields; never parse channel names for numbers |
| B44 | L | V | SQLite `calls` and `operator_daily_stats` are written on every call but not read by any dashboard/report (only topic analytics reads `calls`) | `db:579-661`; readers `topicAnalyticsService.js:241`, `:687-705` | Decide whether to keep a local call store; if yes, make it the single source |
| B45 | L | V | `getOperatorList` mutates state and runs 3 SQLite aggregates per call; called on almost every event | `ami:2425-2427`, `ami:2467-2505` | Pure projection over cached aggregates |
| B46 | M | V | `syncIssabelData` (15 s) has no in-flight guard; heavy SQL every 5 s on the production PBX | `ami:65`, `idb:137` | Single scheduler with locking; CEL/AMI-driven incremental updates |
| B47 | L | V | `agentActiveCalls` never stores `DIALLED`, but the stale check looks for it | `ami:177`, `ami:3022` | Track outbound agent calls explicitly or drop the check |
| B48 | L | V | `durationSec === 0` strict: a string `"0"` or a missing value skips the failed-attempt record | `app:3782` | Validate/coerce the payload schema |
| B49 | M | S | Unique key `(operator_id, caller_id, start_time)` + `INSERT OR IGNORE`: if the agent sends several events of one call with the same `startTime`, only the first (often `RINGING`) is kept | `db:120`, `db:824-839` | Store raw events append-only with an event id; derive per-call outcome |
| B50 | M | V | Two independent day-rollovers reset different field sets at different times; `queue reset stats` clears all Asterisk queue stats | `ami:376-395`, `ami:2580-2608` | One rollover job; don't reset PBX stats unless required |
| B51 | L | V | Dead/wasted AMI counters (`hourlyInbound/Outbound`, `queueAbandonedCalls`, `stats.totalCalls` from every non-Local `Newchannel` incl. operator legs) | `ami:32-33`, `ami:989`, `ami:1701-1709` | Remove |
| B52 | L | S | `AttendedTransfer` reads `evt.targetchannel` (not an Asterisk field); `CoreShowChannel` reads `evt.extension` (Asterisk 11 name; 12+ uses `Exten`) so `extension` falls back to the context name | `ami:2025-2026`, `ami:1549` | Target one Asterisk version; type the events |
| B53 | L | V | `QueueEntry` de-duplicates waiting callers by caller ID, not channel (two hidden callers collapse) | `ami:931` | Key by channel/uniqueid |
| B54 | M | V | Operator card shows `offline` whenever SIP has no IP, even with the desktop agent connected and a call in progress; callback badges use a different "online" test (SIP or agent) | `ami:2460-2467` vs `ami:199-207` | One presence model with explicit precedence |
| B55 | M | V | `AgentConnect` resolves callbacks at pickup (no talk-time threshold); `BridgeEnter` resolves any bridged outbound (voicemail/announcement included); no outcome is recorded | `ami:1482-1487`, `ami:1777-1784` | Resolve on a completed conversation ≥ N s, record outcome |
| B56 | L | V | `activeCount` counts all channels incl. `Local;1` and both legs | `ami:2888` | Count calls (linkedid) |

The 2026-11-17 review (`docs/REVIEW-2026-11-17.md`, §4) states that manual `callsTaken` edits change routing under `fewestcalls`; the code does not write the value to Asterisk (B26).

---

## 9. Hardcoded business data → configuration

| Data | Value(s) in code | Where | Proposed config |
|---|---|---|---|
| Operator directory (ext → name) | 101 Oybek, 103 Feruza, 106 Ubaydullayeva Gulchehra, 111 Nozima, 114 Maxmudbek, 119 Muattar, 120 Navruzoy (×4 copies + RU translations) | `idb:9-17`, `db:12-20`, `app:488-496`, `exportService.js:670-697`, viewer copies | `operators` table (ext, display names per locale, group, active, excluded), sourced from `asterisk.users` + overrides |
| Special operator 114 | name forced to `Maxmudbek` regardless of PBX; only operator with a personal blacklist (`blacklist_114`) and UI blacklist access | `ami:2450`; `idb:109`, `idb:280-287`, `idb:469`, `idb:1029-1038`, `idb:1044`, `idb:1338`, `idb:2053`, `idb:2079`, `idb:2379`; `bl:88`, `bl:98`, `bl:180`, `bl:225` | per-operator feature flags (`hasPersonalBlacklist`, AstDB family name) and name override |
| Extension 119 shared by two people | Muattar and "Zuhra opa" use 119; split by voice-print AI (`speaker` filter maps both to search `119`) | `app:1801-1810`, `idb:2659-2660`, `voicePrintService.js:59-71` | model "agents" separately from "extensions" (agent ↔ extension assignments over time) |
| Operator groups | main = 100–199 (`Asosiy`), secondary = 200+ (`Zangiota 42`); default lists `[101,103,106,111,114,119,120]` and `[200,203,204,205,206,208,209]`; `2xx` labeled `Zangiota` | `exportService.js:143-160`, `:248-249`, `:270-271`, `:711-724`; `app:513` | `operator_groups` table (id, name per locale, extension ranges/members) |
| Operator channel ranges | SIP/1xx, 2xx, 4xx treated as operator phones | `ami:2063`, `ami:2414` | derived from operator directory |
| Extension parser heuristics | 2–4 digits; reject prefixes `71`, `90`; mobile/city prefixes `71,78,90,91,93,94,95,97,98,99,33,88` | `ami:639-657`, `ami:1675` | config: extension pattern, national number plan |
| Trunk / DID / queue | `712020159`, `2020159` (trunk channel `SIP/712020159`, DID, queue name, excluded from callers/callbacks) | `ami:330-331`, `ami:673-679`, `ami:948`, `ami:978`, `ami:1424`, `ami:1568`, `ami:1675`, `ami:1830-1831`, `ami:1934`, `ami:2321`, `ami:2903`; `db:219-223`, `db:583`, `db:1099`, `db:1125`; many SQL filters in `idb` | `trunks` (name, DID, channel prefix), `queues` (name, display name `Asosiy Navbat`) |
| Dialplan contexts | `from-internal`, `from-queue`, `ext-queues`, `from-trunk`, `from-pstn`, `ivr-4`, `from-internal-xfer`, `dialout`/`outbound`; IVR off-hours marker `working-time|music-working-time` in `lastdata` | `idb:174`, `idb:188`, `idb:256`, `idb:708`; `ami:1569`, `ami:1676`, `ami:2147-2156` | config map of context roles |
| Channel technology | `SIP/<ext>` for originate, `Local/<ext>@from-queue/n` for queue members | `app:3267`, `app:3282`, `app:3432` | config (chan_sip vs PJSIP, member interface template) |
| Working hours | 08:00–21:00, no weekdays; hourly chart 8..21 | `db:244-245`, SQL `TIME()` filters, `ami:2824-2826`, `idb:378`, `idb:1842` | working calendar (§8 B1) |
| Timezone | `Asia/Tashkent` literals; `+05:00` | throughout; `sync:96` | single app TZ setting |
| PBX endpoints & credentials | host `192.168.0.124` (AMI/SSH/SFTP), SSH user `root`, AMI user and a default AMI password in source; a public PBX IP and the AMI password are also in `scripts/test_ami_events.js` | `config.js:9-11`, `config.js:17-19`, `idb:22-29`, `scripts/test_ami_events.js:7`, `:36` | env/secret store only; rotate the committed password |
| IP → operator maps | `192.168.0.17→101`, `.100→103`, `.19→111`, `.18→120`, `.15→119`, `.114/.107→114`, `.106→106`, `.108→108` | `app:1022-1030`, `app:1316-1325`, viewer copies | device registry table |
| Thresholds | 38 s agent timeout, 45 s stale ring, 2 s fresh ring, 60/90 s dedupes, 20 s attempt dedupe, ±120 s / ±3 min matching, 5 min snapshot age, 30 min full callback sync, 2/3/30-day windows, `LIMIT 250/500/300`, fake waits 12 s / 8 s | §1.3, `idb:736`, `db:1156`, `db:1203`, `idb:2113`, `idb:2446` | named config constants (remove the fake waits) |
| Queue sync mode | `grandTotal`, default enabled | `ami:2538`, `ami:2550` | setting with audit |
| Agent OTA | default version `1.0.4`, update URL `/downloads/agent.exe`, compat port 3000 | `app:3473-3487`, `app:4036` | release config |
| Placeholder strings used as data | `Yashirin raqam (Hidden)`, `Mijoz (Ulangan)`, `Operatorga ulanmadi`, `Navbat (Kutishda uzildi)`, `📤` prefix as direction flag | `ami:684`, `ami:2115`, `ami:1510`, `ami:1907`, `ami:1367` | typed fields (null number, enum direction) + i18n labels |

---

## 10. Open questions to settle on the live system before reimplementing

1. Asterisk version (`core show version`) and channel driver (chan_sip vs PJSIP) — decides event/field names (B34, B37, B52).
2. Server timezone of the Node host and of the PBX MariaDB (`SELECT @@global.time_zone, NOW()`) — impact of B2, B4, B5.
3. CDR row shapes for: answered queue call, abandoned queue call, IVR-only hangup, off-hours call, attended/blind transfer (2 and 3 hops), outbound answered/unanswered. Needed for B10, B18, B19, B42 and for redefining KPIs (consider CEL + `linkedid`).
4. Desktop agent payloads: `SELECT event_type, duration_sec>0, COUNT(*) FROM agent_3cx_call_logs GROUP BY 1,2` and a sample of one call's events — impact of B23, B49.
5. The PBX dialplan that reads AstDB `blacklist_114` (not in this repo) — must be preserved or ported.
6. Whether the business wants `ivr_non_working` callbacks shown (B8) and a Mon–Fri rule (B1).
7. Whether manual `callsTaken` editing should affect routing at all (B26).

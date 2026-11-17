# Legacy API inventory (HTTP + WebSocket)

Source of truth: `legacy/app.js` (main server, port **3535**), `legacy/viewer/app.js` (operator portal, port **3005**), `legacy/services/webauthnService.js`. `legacy/swaggerSpec.js` covers only 15 paths, advertises `http://localhost:3000`, and documents `/api/db/query` as working (it now returns 410). The code below takes precedence over it.
Line references are to the current `rewrite/foundation` branch (commit `63352e3`).

---

## 0. Conventions and cross-cutting behaviour

### 0.1 Auth legend (used in the "Auth" column)

| Code | Meaning |
|---|---|
| `none` | No auth at all. |
| `S-any` | Any valid session, **any role incl. operator**. On 3535 these routes are registered *before* the global gateway (app.js:1141), so the operator block does not apply. |
| `S-staff` | 3535 global gateway (app.js:1141-1228): a valid session with role `admin` or `superuser`, **or** a trusted internal request (see `internal`). Operators get 403 JSON `{error:'forbidden', redirect:<viewerUrl>}` on API paths and a 302 to `:3005/?token=…` on pages. No session → 401 `{error:'unauthorized', redirect:'/login'}` (API) or 302 `/login`. Exceptions for operators: `/api/auth/me`, `/api/auth/logout`, `/logout`, `/api/presence/online-users`. |
| `admin+` | Explicit check: role ∈ {`admin`,`superuser`}. Note that `requireSuperuser` (app.js:724) **also accepts `admin`**, despite its name. |
| `superuser` | Explicit check: `role === 'superuser'`. |
| `user!=superuser` | Additional block on the literal username `superuser` (the "boss" account), not on the role. |
| `internal` | `isTrustedInternalRequest` (app.js:64): loopback socket, **no** `x-forwarded-for`, and `x-internal-token` == `INTERNAL_API_TOKEN` (from `.env`, otherwise from `data/.internal_token`, which is auto-generated). Sets `req.isInternal`. The viewer also sends `x-acting-user`, which is used only for audit (`getActorName`). |
| `bl-pass` | Blacklist password `BLACKLIST_ADMIN_PASSWORD`, taken from `x-blacklist-auth` **or** raw `Authorization` header **or** `?password=` **or** `body.password`. If the env var is empty, every request is denied. |
| `agent` | No session. If `AGENT_API_KEY` is set, `x-agent-key` must match (only for heartbeat, call-event, sync-batch, update-log, reject). The body is sanitized (app.js:1095): `operatorId` must match `^[0-9]{2,6}$`, and text/phone fields are stripped and truncated. |
| `V-any` | 3005 gateway (viewer/app.js:329): the token is validated by calling 3535 `GET /api/auth/me` with `Bearer` (cached for 60 s per token). **Any role**, including operators. No session → 401 JSON `{redirect: loginUrl}` (API) or 302 to `https://uniconsoft.ddns.net/login` / `https://<host>:3535/login`. |

**Token sources.** 3535 (`authService.extractToken`): cookie `cc_session`, then `Authorization: Bearer`. 3005 (`extractToken`): `Bearer`, then cookie `cc_viewer_session`, then cookie `cc_session`, then `?token=`. When the token arrived via `?token=`, 3005 sets the `cc_session` cookie (HttpOnly, Secure, Lax, 7 days).

**Session object** (`validateSession`, used as `req.user`): `{username, token, role, operatorId, email}`. Roles are `superuser | admin | operator`. Password-login sessions last 7 days. Passkey-login sessions last **30 days** (webauthnService default `sessionDays`).

### 0.2 Middleware order and global behaviour

| App | Order (top → bottom) |
|---|---|
| 3535 | security headers → `cors()` (open) → gzip → **`/telegram-form` proxy (no auth)** → body parsers (50 MB for `/api/converter/convert` and `/api/dev/visual-prompt`, 2 MB otherwise) → rate limiters → `/api/security/*` → HTTP→HTTPS 301 (only when `ssl/server.{key,crt}` exist; skipped for loopback, `/.well-known/`, `/api/agent/*`) → pre-gateway routes (login, auth, passkeys, profile, forgot-password, dev inbox, `/api/settings/*`) → agent sanitizer → **global auth gateway** → static `public/` → swagger → all other routes → SPA routes → catch-all `index.html` (**unknown `/api/*` returns `index.html` with 200** for logged-in staff). |
| 3005 | gzip → headers → `cors()` → **`/telegram-form` proxy (no auth)** → body parsers (50 MB for converter and `/api/tickets`) → rate limiter → `/api/security/*` → **HTTP→HTTPS 301 for everything, even when no certificate is present** (except loopback `/api/internal/invalidate-sessions`) → logout → internal invalidate → gateway (`V-any`, with whitelist) → static → routes → catch-all `index.html` (unknown `/api/*` also returns HTML). |
| 3000 (compat) | Started by 3535 when `PORT != 3000`. Only `/api/agent/*` is forwarded into the 3535 app (`app.handle`). Every other socket is destroyed. |

**3005 gateway whitelist (`none`):** `/favicon.*`, `/api/version`, `/version.json`, `/guide*`, `/manual*`, `/yoriqnoma`, `/data/*`, `/api/auth/webauthn/*`, `/vendor/*`, `/passkey-client.js`, `/api/remote-desktop/report-installed`, `/api/speedtest/*`, `/api/tools/uzcrypto/*`, `/icons/`, `/images/`, `/img/`, `/css/`, `/js/`, `/fonts/`, **`/uploads/*` (ticket attachments are public)**, `/downloads/*`, `/tools/*`.

**3535 gateway whitelist (`none`):** `/login`, `/logout`, `/api/auth/login`, `/api/auth/logout`, `/api/version`, `/version.json`, `/api/tools/uzcrypto*`, `/favicon.ico`, `/css/`, `/js/`, `/vendor/`, `/icons/`, `/images/`, `/fonts/`, `/.well-known/`, `/api/agent/{heartbeat,call-event,sync-batch,version,update-log,reject}`.

### 0.3 Rate limits

| Limiter | Scope | Limit (external / internal 192.168.*) |
|---|---|---|
| `globalApiLimiter` (3535), `viewerApiLimiter` (3005) | `/api/*` | 180/min / 3000/min |
| `authLimiter` (3535) | `/api/auth/login` | 15/min / 60/min |
| `heavyLimiter` (3535) | `/api/converter/`, `/api/export-excel`, `/api/download-recordings-zip` | 12/min / 120/min. **The last two paths do not exist**: the real ones are `/api/export/excel` and `/api/recordings/download-*`, so in practice the limiter covers only the converter. |
| WebAuthn internal | login-options/verify: 60/min/IP. Unknown credential: 30 fails/min/IP. Per passkey: 5 fails/min. Password re-auth: 5 fails/5 min/user. | — |
| Login lockout (`authService`) | keyed by IP and by username | threshold 3–10 (default from settings), duration 1–1440 min. Configured by `/api/settings/security`. |
| WebSocket | `canAcceptWebSocket` | at most 15 concurrent WebSockets per external IP → `429` on upgrade |

---

## 1. HTTP endpoints by domain

Column "Svc" = service functions called. "3005→3535" = the viewer route forwards to 3535 with `x-internal-token` (so 3535 treats it as `internal` and the operator block does not apply).

### 1.1 Auth & sessions

| Method | Path | App | Auth | Request | Response | Svc / notes |
|---|---|---|---|---|---|---|
| GET | `/login` | 3535 | none | — | `login.html`. With a session: operator → 302 `:3005/?token=<token>`; others → 302 `/` | authService.extractToken/validateSession. The token is placed in the URL. |
| POST | `/api/auth/login` | 3535 | none (authLimiter) | `{username:string, password:string}` | 200 `{success, user:{username, role}, token}` + `Set-Cookie cc_session` (HttpOnly, Lax, Secure only if HTTPS, 7 d). 401 `{success:false, error, locked}`. 429 when locked. | authService.login (lockout by IP and username) |
| ALL | `/logout`, `/api/auth/logout` | 3535 | none | token (cookie/Bearer) | `/logout` → 302 `/login`; API → `{success:true}`. Clears `cc_session`. | authService.logout |
| ALL | `/logout`, `/api/auth/logout` | 3005 | none | token | `/logout` → 302 login URL; API → `{success, redirect}`. Clears `cc_session` and `cc_viewer_session`. | Calls 3535 `POST /api/auth/logout` with Bearer and drops the token from the 60 s cache. |
| GET | `/api/auth/me` | 3535 | S-any | — | 200 `{authenticated:true, user:{username, token, role, operatorId, email}}` (**echoes the token**). 401 `{authenticated:false}` | authService.validateSession. 3005 also uses this to validate sessions. |
| GET | `/api/auth/me` | 3005 | V-any | — | `{authenticated, user:{username, role, operatorId, operatorName, email}}` | `operatorId` comes from the session, **otherwise from the client-IP → operator map** (`operatorIpMap`, seeded with hard-coded IPs and refreshed from `/api/operators` every 30 s). |
| POST | `/api/auth/change-password` | 3535 | S-any | `{currentPassword, newPassword, revokeOtherPasskeys?:bool}` | `{success, message}` / 400 / 401 | authService.verifyUserPassword, updateUserPassword (keeps the current session and ends the others). **unused?** |
| PUT | `/api/auth/profile/email` | 3535 | none (always 403) | — | 403 `{success:false, error}` | Disabled. Use the 2-step flow below. |
| PUT | `/api/auth/profile/email` | 3005 | V-any | any | Proxies the 3535 response (always 403) | 3005→3535 |
| POST | `/api/auth/profile/email/send-code` | 3535 | S-any | `{email?, password:string, action?:'auto'\|'unlink'}` | `{success, step:'unlink_current'\|'bind_new', maskedEmail, expiresInSeconds:120, message}`. 400, or 429 when locked. | authService.requestEmailVerificationCode → emailService |
| POST | `/api/auth/profile/email/send-code` | 3005 | V-any | same | proxied | 3005→3535 (Bearer + internal token) |
| POST | `/api/auth/profile/email/verify` | 3535 | S-any | `{email, code:string(6), step?, targetNewEmail?}` | `{success, step:'bind_new'\|'unlinked'\|'completed', email?, message}`. 400 (`expired:true` possible) or 429. | authService.verifyEmailAndBind |
| POST | `/api/auth/profile/email/verify` | 3005 | V-any | same | proxied. On success, updates `email` in the session cache. | 3005→3535 |
| POST | `/api/auth/forgot-password/request` | 3535 | none | `{identifier: username\|email, email?}` | `{success, username, maskedEmail, expiresInSeconds, simulated, message}`. 400/429. | authService.requestPasswordReset → emailService.sendPasswordResetCode |
| POST | `/api/auth/forgot-password/verify` | 3535 | none | `{username, code}` | `{success, username, resetToken, message}` (3 attempts) | authService.verifyPasswordResetCode |
| POST | `/api/auth/forgot-password/reset` | 3535 | none | `{username, resetToken, newPassword(≥6)}` | `{success, message}` | authService.completePasswordReset |
| GET | `/viewer`, `/viewers` | 3535 | none | — | 302 `<proto>://<host>:3005/?token=<token>` | Puts the token in the URL. |
| GET | `/operators`, `/operator` | 3535 | session | — | admin+ → `index.html`; operator → 302 to 3005; none → `/login` | |
| GET | `/vendor/simplewebauthn-browser.js`, `/passkey-client.js` | both | none | — | JS file | static |

### 1.2 Passkeys (WebAuthn): `webauthnService.mount`, base `/api/auth/webauthn` (all POST)

Configured by `.env`: `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, `WEBAUTHN_ORIGINS` (comma-separated). Uses the SQLite tables `auth_passkeys`, plus `auth_users.webauthn_user_id` and `auth_sessions.passkey_id`. Responses use the `{ok, error}` convention, **not** `{success}`. The 3005 copy (`app.use('/api/auth/webauthn')`) is a pure proxy to 3535. It forwards `Authorization: Bearer` + `cookie: cc_session=<token>`, and duplicates `Set-Cookie` as `cc_viewer_session`.

| Path | App | Auth | Request | Response | Notes |
|---|---|---|---|---|---|
| `/register-options` | 3535 (3005 proxy) | S-any + password re-auth | `{password, deviceName(≤60)}` | `PublicKeyCredentialCreationOptionsJSON` (residentKey + UV required, attestation none, excludeCredentials) | max 10 passkeys/user. 403 on wrong password, 429 after 5 fails in 5 min. |
| `/register-verify` | 3535 (3005 proxy) | S-any | `RegistrationResponseJSON` | `{ok:true, message}`. 400 / 409 (duplicate) | challenge is single-use, 2 min TTL, tied to the user |
| `/login-options` | 3535 (3005 proxy) | none | `{}` | `PublicKeyCredentialRequestOptionsJSON` (discoverable, `allowCredentials:[]`) | IP limit |
| `/login-verify` | 3535 (3005 proxy) | none | `AuthenticationResponseJSON` (requires `id` and `response.userHandle`) | `{ok:true, token, user:{username, role, operator_id}}` + `Set-Cookie cc_session` (Secure, 30 d) | Creates an `auth_sessions` row with `passkey_id`. Uses snake_case `operator_id`, unlike `/api/auth/me`. |
| `/passkeys/list` | 3535 (3005 proxy) | S-any; admin+ for another user | `{username?}` | `{ok, passkeys:[{id, device_name, device_type, backed_up, created_at, last_used_at}]}` | |
| `/passkeys/delete` | 3535 (3005 proxy) | own passkey, or admin+ | `{id}` | `{ok:true}` | Also deletes the sessions created by that passkey. |

### 1.3 Settings / users / RBAC (3535, all registered pre-gateway with `requireSuperuser` = **admin+**)

| Method | Path | Request | Response | Svc / notes |
|---|---|---|---|---|
| GET | `/api/settings/security` | — | `{success, lockoutThreshold, lockoutDurationMinutes}` | authService.getLockoutThreshold/Duration |
| POST | `/api/settings/security` | `{lockoutThreshold:int 3-10, lockoutDurationMinutes:int 1-1440}` | `{success, message, lockoutThreshold, lockoutDurationMinutes}` | authService.setSetting (`auth_lockout_threshold`, `auth_lockout_duration_min`) |
| GET | `/api/settings/lockouts` | — | `{success, lockouts:[…]}` | authService.getActiveLockouts |
| POST | `/api/settings/unlock` | `{key: ip\|username}` | `{success, ok, message}` | authService.unlockKey |
| POST | `/api/settings/unlock-all` | — | `{success, count, message}` | authService.unlockAll |
| GET | `/api/settings/exclude-list` | — | `{success, excluded:[id], operators:[{id, name, isExcluded}]}` | authService.getExcludedOperators, issabelDbService.getExistingAsteriskUsers (SSH/MySQL). The `amiService.getAgents` branch is a no-op because that method does not exist. |
| POST | `/api/settings/exclude-list` | `{excluded: string[]}` | `{success, message, excluded}` | authService.setExcludedOperators, issabelDbService.updateExcludedOperators, removes the IDs from amiService.operators. WS: `operators_update`, `excluded_operators_update`. |
| GET | `/api/settings/users` | — | `{success, users:[{id, username, email, role, operatorId, created_at, updated_at}]}` | authService.listUsers |
| POST | `/api/settings/users` | `{username(3-32, [A-Za-z0-9_.-]), password(≥6), role:'superuser'\|'admin'\|'operator' (anything else becomes operator), operatorId (required if operator), email?}` | `{success, message, user:{username, role, operatorId, email}}` | authService.createUser. **An admin can create a superuser.** |
| PUT | `/api/settings/users/:username/email` | `{email}` | `{success, message, email}` | authService.updateUserEmail. **unused?** |
| PUT | `/api/settings/users/:username/operator-id` | `{operatorId\|null}` | `{success, message, user}` | authService.updateUserOperatorId. **unused?** |
| PUT | `/api/settings/users/:username/password` | `{password(≥6), revokePasskeys?:bool (default true)}` | `{success, message, kickedCount}` | authService.updateUserPassword. Kicks the user's 3535 WS (`session_terminated`, close 4001) and calls 3005 `POST /api/internal/invalidate-sessions {username}`. |
| PUT | `/api/settings/users/:username/role` | `{role}` | `{success, message, role}` | authService.updateUserRole. The last superuser cannot be demoted. **unused?** |
| DELETE | `/api/settings/users/:username` | — | `{success, message}` | authService.deleteUser. A user cannot delete themselves; the last superuser is protected. |
| GET | `/api/settings/sessions` | — | `{success, count, sessions:[{id: sha256(token)[0:32], tokenPreview, username, role, ip, userAgent, createdAt, expiresAt, operator:{id, name}\|null, isCurrent}]}` | authService.listActiveSessions + operator match by IP (amiService list + hard-coded IP map) |
| DELETE | `/api/settings/sessions/:id` | `:id` = hashed id | `{success, message}`. 404, or 400 if it is the current session. | authService.terminateSession |
| GET | `/api/viewer/sessions` | 3005, V-any (3535 enforces admin+) | — | proxies `/api/settings/sessions` | Uses the user's **Bearer** token, not the internal token. |

### 1.4 Security / anti-DDoS

| Method | Path | App | Auth | Request | Response | Svc |
|---|---|---|---|---|---|---|
| GET | `/api/security/stats` | 3535 | admin+ | — | `{success, stats:{totalRequests, passedRequests, blockedRequests, jailedIpsCount, jailedIps:[{ip, reason, jailedAt, remainingSeconds}], activeTrackedIps, activeWsPerIp, history, recentEvents}}` | rateLimitService.getStats |
| POST | `/api/security/unjail` | 3535 | admin+ | `{ip}` | `{success, message}` | rateLimitService.unjailIp |
| POST | `/api/security/simulate-flood` | 3535 | admin+ | `{count:int 10-500 (default 50), ip?}` | `{success, message}` | Mutates the counters and jails a fake IP for 15 min (test tool). |
| GET | `/api/security/stats` | 3005 | admin+ (via upstream `/me`) | — | same shape, for the **viewer's own** limiter | viewer rateLimitService. **unused?** |
| POST | `/api/security/unjail` | 3005 | admin+ | `{ip}` | `{success, message}` | **unused?** |
| POST | `/api/dev/visual-prompt` | 3535 | superuser + env `ENABLE_DEV_INBOX=true` (else 404) | `{prompt?, element?, elements?:[], task?, images?:[{base64, name}]\|image?}` (50 MB) | `{success, message, task}` | Writes `scratch/ui_inbox.json` (AI-agent inbox) and `scratch/uploads/*`. Dev tool. |
| POST | `/api/dev/visual-prompt` | 3005 | superuser + env flag | `{prompt, element?, elements?, task?}` (10 MB, no images) | `{success, message, task}` | Writes `../scratch` or `/opt/call-center/scratch`. |

### 1.5 Dashboard / stats / presence (3535; viewer proxies marked)

| Method | Path | App | Auth | Request | Response | Svc / notes |
|---|---|---|---|---|---|---|
| GET | `/api/version` | 3535 | none | — | `{buildId, buildTime, version, app}` from `public/version.json` | no-cache |
| GET | `/api/version` | 3005 | none | — | same, from the viewer's own `version.json` (`app:'call-center-viewer'`) | |
| GET | `/api/status` | 3535 | S-staff | — | `{amiConnected, sftpConnected, host}` | amiService/sftpService flags |
| GET | `/api/status` | 3005 | V-any | — | 3535 body + `sftpConnected:false, mode:'viewer_operators_only'`. If upstream fails: hard-coded `{amiConnected:true, host:'192.168.0.124', sftpConnected:false}` | 3005→3535. **unused?** |
| GET | `/api/presence/online-users` | 3535 | S-staff **or operator** | — | `{success, count, users:[PresenceUser]}` | in-memory WS clients (see §2.1) |
| GET | `/api/stats` | 3535 | S-staff | `?date=YYYY-MM-DD` | `SummaryStats` (live today). For a past date: issabelDbService.fetchFullStatsByDate (same keys; `null` on error). | amiService.ensureInitialSync/getSummaryStats |
| GET | `/api/queues` | 3535 | S-staff | — | `[QueueSummary]` | amiService.getQueueSummaryList |
| GET | `/api/channels` | 3535 | S-staff | — | `[Channel]` | amiService.getActiveChannelsList. **unused?** |
| GET | `/api/operators` | 3535 | S-staff | `?date=YYYY-MM-DD` | today: `[Operator]`. Past date: `[{id, name, realName, presence, ip, latency, totalCalls, answered, rawAnswered, outbound, transferredOut, transferredIn, transferResolved, denied, missed, totalDurationSec, avgDurationSec, grandTotal, paused, agentConnected, agentHostname, agentVersion, lastAgentPing}]` | amiService.getOperatorList + issabelDbService.fetchOperatorStats |
| GET | `/api/operators` | 3005 | V-any | same query | 3535 array, with `rustdeskInstalled:bool` added per operator | 3005→3535 + `rustdeskDevices` map |
| GET | `/api/db/summary` | 3535 | S-staff | `?date` | `{success, data}` | issabelDbService.fetchSummaryByDate. **unused?** |
| GET | `/api/db/operators` | 3535 | S-staff | `?date` | `{success, data:[…]}` | issabelDbService.fetchOperatorStats. **unused?** |
| POST | `/api/db/query` | 3535 | S-staff | — | **410** `{success:false, error}` | Removed (it was an RCE vector). Still listed in swagger. **dead** |
| GET | `/api-docs`, `/swagger`, `/api/docs-json` | 3535 | S-staff | — | Swagger UI / redirect / spec JSON | swaggerSpec.js (stale). **unused?** |

### 1.6 History / calls

| Method | Path | App | Auth | Request | Response | Svc / notes |
|---|---|---|---|---|---|---|
| GET | `/api/history` | 3535 | S-staff | `?page=1&limit=20&search&date=(YYYY-MM-DD\|all\|all_time\|A_B range)&direction&status&speaker=(zuhra\|muattar)` | `{total, page, totalPages, limit, data:[CallRecord + voiceAnalysis?{speaker, speaker_name, score, zuhra_segments, confidence}]}`. Errors are swallowed and return an empty page. | issabelDbService.fetchCallsPaginated (Redis cache 15 s today / 7 d past) + voicePrintService.findAnalysis. `speaker=zuhra` returns voicePrintService.getCallsBySpeaker instead (**different item shape**: voice-ID rows). `speaker=muattar` forces search `119`. |
| GET | `/api/calls/recent` | 3535 | S-staff | `?limit(≤200, default 50)&date` | **bare array** `[CallRecord]` | issabelDbService.fetchCallsPaginated(skipCount). Falls back to the last 7 days, then to amiService.getCallHistory. |
| GET | `/api/calls/recent` | 3005 | V-any | same | array passed through `sanitizeCalls` (drops `recording`, `recordingfile`, `uniqueid_clean`) | 3005→3535. **unused?** (by viewer UI) |
| GET | `/api/calls/details` | 3535 | S-staff | `?type=(all\|inbound\|outbound\|answered\|abandoned\|missed\|denied\|transferred\|operator)&operator=<digits>&page&limit(10-500, default 50)&search&date` | `{success, total, page, totalPages, limit, data:[CallRecord(+source:'3cx_agent')]}` | issabelDbService.fetchCallsDetail (also merges `agent_3cx_call_logs`) |
| GET | `/api/calls/details` | 3005 | V-any | same | same, `data` sanitized | 3005→3535 |

### 1.7 Callbacks (missed-call follow-ups; table `pending_callbacks`)

| Method | Path | App | Auth | Request | Response | Svc / notes |
|---|---|---|---|---|---|---|
| GET | `/api/callbacks` | 3535 | S-staff | `?filter=(all\|today\|YYYY-MM-DD)` | `{success, data:[Callback]}` | amiService.getCallbacksWithActiveCalls → dbService.getCallbacks |
| GET | `/api/callbacks` | 3005 | V-any | same | proxied as-is | 3005→3535 |
| DELETE | `/api/callbacks/:id` | 3535 | S-staff (the comment says "admin only", but there is no role check beyond the gateway) | `:id` int | `{success, message, data:[Callback]}` / 404 | dbService.dismissCallback(id, actor). WS `callbacks_update`. |
| DELETE | `/api/callbacks/:id` | 3005 | admin+ | `:id` int > 0 | proxied | 3005→3535 with `x-acting-user`. **unused?** (viewer UI) |
| DELETE | `/api/callbacks` | 3535 | S-staff | — | `{success, message, data}` | dbService.dismissAllCallbacks(actor). WS `callbacks_update`. |
| DELETE | `/api/callbacks` | 3005 | admin+ | — | proxied | 3005→3535. **unused?** |
| POST | `/api/callbacks/sync` | 3535 | S-staff | `?days` or `{days}` (default 30) | `{success, data}` | issabelDbService.syncPendingCallbacks. WS `callbacks_update`. |

### 1.8 Contacts (phone book; table `client_contacts`)

| Method | Path | App | Auth | Request | Response | Svc / notes |
|---|---|---|---|---|---|---|
| GET | `/api/contacts` | 3535 | S-staff | `?q\|search&lang\|language` | `{success, data:[Contact], total}` | dbService.searchContacts / getAllContacts |
| GET | `/api/contacts` | 3005 | V-any; 200-group gets an empty list | same | proxied, or `{success, contacts:[], count:0, data:[]}` for 200-group | 3005→3535, `checkIs200Operator` |
| GET | `/api/contacts/top-active` | 3535 | S-staff | `?limit=15&date=today` | `{success, data:[{phone, name, organization, language, notes, is_saved, total_calls, answered_calls, total_duration_sec, last_call_time}], total}` | issabelDbService.fetchTopClients, falling back to dbService.getTopClients. Enriched with dbService.getContact. |
| GET | `/api/contacts/top-active` | 3005 | V-any; 200-group gets empty | same | proxied | 3005→3535. **unused?** (viewer UI) |
| GET | `/api/contacts/:phone` | 3535 | S-staff | — | `{success, data:Contact\|null}` | dbService.getContact. **unused?** |
| GET | `/api/contacts/:phone` | 3005 | V-any; 200-group → 403 | — | proxied | 3005→3535. **unused?** |
| POST | `/api/contacts` | 3535 | S-staff | `{phone (required), name?, organization?, notes?, language?, telegram_user_id\|telegramUserId?}` (at least one of name/org/tgId) | `{success, message, data:Contact}` | dbService.saveContact (upsert). WS `client_contacts_update {action:'upsert', contact}`. |
| POST | `/api/contacts` | 3005 | V-any; 200-group → 403 | same | proxied | 3005→3535 (no `x-acting-user`) |
| DELETE | `/api/contacts/:phone` | 3535 | S-staff | — | `{success, message}` / 404 | dbService.deleteContact. WS `client_contacts_update {action:'delete', phone}`. |
| DELETE | `/api/contacts/:phone` | 3005 | V-any; 200-group → 403 | — | proxied | 3005→3535 |

### 1.9 Recordings & ZIP jobs (3535 only; the viewer never proxies recordings)

| Method | Path | Auth | Request | Response | Svc / notes |
|---|---|---|---|---|---|
| GET | `/api/recordings/tree` | S-staff | `?path` (relative to monitor root) | `{success, currentPath, fullRemotePath, directories:[…], files:[{name, path, type, size, sizeFormatted, modifyTime}], isRealSftp}` | sftpService.listDirectory (traversal-guarded) |
| GET | `/api/recordings/stream` | S-staff | `?file=<path>&download=1\|dl=1`, `Range` header | audio stream (206 for ranges; attachment when downloading) | sftpService.streamFile |
| POST | `/api/recordings/download-zip` | S-staff | `{files: string[] \| JSON string, zipName?}` | streamed `.zip` | sftpService.downloadFilesAsZip. **unused?** |
| GET | `/api/recordings/download-zip` | S-staff | `?files=<JSON\|comma list>&zipName` | streamed `.zip` | **unused?** |
| GET | `/api/recordings/range-count` | S-staff | `?startDate&endDate (required)&search&direction&status&speaker` | `{success, startDate, endDate, count, durationSec}` | issabelDbService.countRecordingsByDateRange. **unused?** |
| GET/POST | `/api/recordings/download-range-zip` | S-staff | same filters (query or body) + `zipName?` | streamed `.zip` (max 5000 files) | issabelDbService.fetchRecordingsByDateRange + sftpService.downloadFilesAsZip. **unused?** (superseded by zip-jobs) |
| POST | `/api/recordings/zip-jobs` | S-staff | `{files?:string[]}` **or** `{startDate, endDate, search?, direction?, status?, speaker?}` + `zipName?` | `{success, jobId, total, zipName, status:'queued'\|'processing', queuePosition}` / 400 / 404 | zipJobService.startZipJob. `initiatedBy` is always `'anonymous'` (it reads `req.session`, which does not exist). |
| GET | `/api/recordings/zip-jobs/:id` | S-staff | — | `{success, job:{id, status(queued\|processing\|ready\|failed\|cancelled), queuePosition, progress, processed, total, added, currentFile, fileSize, fileSizeFormatted, zipName, createdAt, completedAt, error}}` | zipJobService.getJob |
| GET | `/api/recordings/zip-jobs/:id/download` | S-staff | — | file download (Range supported). 202 `{progress}` while processing; 500 if failed; 404. | zipJobService.getReadyFilePath |
| POST | `/api/recordings/zip-jobs/:id/cancel` | S-staff | — | `{success, cancelled}` | zipJobService.cancelJob |
| GET | `/api/recordings/fast-find` | S-staff | `?callerId\|search&uniqueid&duration` | `{success, found:true, recording, filename, duration, callerId}` or `{success, found:false, message}` | audioIndexService.findAudioByUniqueId / findAudioForCaller (today's in-RAM index) |
| GET | `/api/recordings/index-status` | S-staff | — | `{success, indexedCount, uniqueCallersCount, lastSyncTime, todayDate, …}` | audioIndexService.getStatus. **unused?** |

### 1.10 Transcription / STT (3535)

| Method | Path | Auth | Request | Response | Svc / notes |
|---|---|---|---|---|---|
| POST | `/api/recordings/transcribe` | S-staff | `{recFile?, callerId?, duration?, callKey?}` (recFile or callKey required) | `{success, text, rawText, duration, cached?}` / `{success:false, error}` | sttService.transcribe (Python Wav2Vec2 + Gemini cleanup, SQLite cache) |
| GET | `/api/recordings/transcribe` | S-staff | same, as query | same | **unused?** |
| GET | `/api/recordings/transcribe/stats` | S-staff | — | `{success, totalWords, learnedWordsCount, …learnedStats}` | sttCleanerService.getLearnedStats |
| GET | `/api/recordings/transcribed-list` | S-staff | — | `{success, count, data:[TranscriptRow]}` | sttService.getAllTranscribed. **unused?** |
| POST | `/api/recordings/transcribe/check-batch` | S-staff | `{keys?:string[], files?:string[], calls?:[{rowKey, callerId, duration, recording}]}` | `{success, map:{<key>: TranscriptRow}}` (keys: callKey, basename, digits-only caller, `caller_duration`) | sttService.getAllTranscribed (in-memory join) |
| POST | `/api/recordings/transcribe/reprocess` | S-staff | `{callKey, recFile}` | `{success, text, rawText}` / 404 | sttService.getCached, cleanAndLearn, saveToCache |
| POST | `/api/recordings/transcribe/save` | S-staff | `{callKey, recFile, formattedText:string}` | result of saveManualTranscription (`{success, …}`) | sttService.saveManualTranscription |

### 1.11 Topic analytics (3535; S-staff **and** user!=superuser, otherwise 403)

| Method | Path | Request | Response | Svc |
|---|---|---|---|---|
| GET | `/api/analytics/topics/summary` | `?period=(day\|month\|year\|custom)&year&month&date&startDate&endDate` | `{success, data:{…}, period, year, month, date?, latestDate, totalCalls, total_calls, topTopic, topics:[…]}` (the payload is duplicated: `data` plus spread keys) | topicAnalyticsService.getTopicSummary |
| GET | `/api/analytics/topics/trend` | same | `{success, data, period, timeline:[{label, displayLabel, …}]}` | getTopicTrend |
| GET | `/api/analytics/topics/calls` | `+ page, limit(25), search, topic` | `{success, data:items, items, total, page, limit, …}` | getTopicCalls |
| GET | `/api/analytics/topics/dates` | — | `{success, dates:[YYYY-MM-DD]}` | getAvailableDates |
| POST | `/api/analytics/topics/analyze` | `{period, year, month, date}` | `{success, analyzedCount, period, date, year, month, message, summary}` | runTopicAnalysis (STT + keywords → `call_topic_analytics`) |

### 1.12 Voice identification (3535, all S-staff; **all unused by the frontends**)

The orchestrator `scripts/voice_scan_orchestrator.js` and the Python scripts `build_oybek_profile.py`, `generate_oybek_snowball.py` and `build_zuhra_ensemble.py` are **missing from the repo**. Data lives in `data/*.json`. The analysis date range (2026-08-17..09-19) and the target count of 558 are hard-coded.

| Method | Path | Request | Response | Svc / notes |
|---|---|---|---|---|
| GET | `/api/voice-identifications` | — | `[VoiceId{file, caller_id, calldate, speaker, speaker_name, score, zuhra_segments, confidence, is_verified, is_manual_override}]` | voicePrintService.getAll |
| GET | `/api/voice-scan-status` | — | `{totalTarget, scannedCount, remainingCount, percent, zuhraCount, muattarCount, isRescan, previousZuhraCount, newlyFoundZuhraCount, newlyFoundZuhraList, speedPerMin, etaMinutes, estimatedEndTime, dateRange, currentTask, lastScanned}` | reads `data/voice_scan_status.json` |
| POST | `/api/internal/voice-scan-sync` | `{status?:object, newVoiceId?:VoiceId}` | `{success, restartRequested}` | **Despite the name, it is not token-protected beyond S-staff/internal.** Writes JSON files and runs voicePrintService.load. |
| POST | `/api/voice-identification/switch` | `{file, newSpeaker}` | `{success, item}` / 404 | voicePrintService.updateSpeaker |
| POST | `/api/voice-identification/verify` | `{file, is_verified}` | `{success, item}` | voicePrintService.toggleVerified |
| GET | `/api/voice-samples` | — | `{success, samples, stats:{total, approved, denied, pending}}` | `data/voice_candidate_samples.json` |
| POST | `/api/voice-samples/review` | `{sampleId, status:'approved'\|'denied'\|'pending'}` | `{success, item, stats}` | falls back to `oybek_samples.json` |
| GET | `/api/voice-samples/oybek` | — | `{success, samples, count, stats}` | |
| POST | `/api/voice-samples/oybek/review` | `{sampleId, status:'approved'\|'denied'}` | `{success, item, stats}` | |
| POST | `/api/voice-samples/oybek/apply-ensemble` | — | Python stdout JSON | `exec python3 scripts/build_oybek_profile.py` (missing) |
| POST | `/api/voice-samples/generate-snowball` | `{batchSize=6}` | `{success, batch, addedCount, allSamples, …}` | voiceSnowballService.generateNextBatch |
| POST | `/api/voice-samples/oybek/generate-snowball` | `{batchSize=6}` | Python stdout JSON | `exec … generate_oybek_snowball.py` (missing) |
| GET | `/api/voice-scan/dual-speaker-results` | — | `{success, count, results}` | `data/dual_speaker_results.json` |
| POST | `/api/voice-samples/apply-ensemble` | — | canned `{success, approved_count, …}` if `zuhra_profile_ensemble.pt` exists, otherwise Python stdout | `build_zuhra_ensemble.py` (missing) |
| POST | `/api/voice-scan/restart` | — | `{success, message}` | Resets the status file and spawns `node scripts/voice_scan_orchestrator.js --rescan` (missing). |
| GET | `/api/voice-scan/restart-status` | — | `{restartRequested}` | in-memory flag |
| POST | `/api/voice-scan/restart-ack` | — | `{success}` | clears the flag |

### 1.13 Blacklist (Asterisk AstDB + SQLite)

| Method | Path | App | Auth | Request | Response | Svc / notes |
|---|---|---|---|---|---|---|
| POST | `/api/blacklist/verify` | 3535 | S-staff | `{password}` | `{success, message}` / 401 | blacklistService.verifyPassword |
| GET | `/api/blacklist` | 3535 | S-staff + bl-pass | header `x-blacklist-auth` | `{success, count, data:[{number, formattedNumber, variants[], note, createdAt, updatedAt}]}` | blacklistService.getAll |
| POST | `/api/blacklist` | 3535 | S-staff + bl-pass | `{number, note?}` | `{success, message, data:{number, formattedNumber, variants, note, createdAt}}` | blacklistService.add (also writes AstDB via SSH) |
| DELETE | `/api/blacklist/:number` | 3535 | S-staff + bl-pass | — | `{success, message, data:{success, removedNumber}}` | blacklistService.remove |
| POST/GET/POST/DELETE | same 4 paths | 3005 | V-any (+ bl-pass enforced by 3535) | same. Only the `x-blacklist-auth` header is forwarded; the body is forwarded on POST. | proxied | 3005→3535, so **any operator who knows the password** can manage the blacklist. |

### 1.14 Queue / operator actions (3535 = S-staff; the viewer only has a 403 stub)

| Method | Path | App | Request | Response | Svc / notes |
|---|---|---|---|---|---|
| POST | `/api/operator/pause` | 3535 | `{extension, paused:bool}` | `{success, extension, paused, message}` | issabelDbService.execCommand(`asterisk -rx "queue pause\|unpause member Local/<ext>@from-queue/n"`) via SSH. Mutates amiService.operators. WS `operators_update`. |
| POST | `/api/operator/pause` | 3005 | any | **403** always | stub. **unused?** |
| POST | `/api/action/transfer` | 3535 | `{channel, targetExten}` | `{success, message, response}` | amiService.transferCall (AMI Redirect, context from-internal) |
| POST | `/api/action/hangup` | 3535 | `{channel}` | `{success, response}` | AMI `Hangup`. Also removes the channel from memory and calls recalculateConversations. |
| POST | `/api/action/originate` | 3535 | `{from:ext, to:number}` | `{success, response}` | AMI `Originate SIP/<from>` → exten `to` @ from-internal. Marks the operator as ringing. **unused?** (swagger only) |
| POST | `/api/queue/adjust-calls` | 3535 | `{operatorId, delta?=1, value?:number, reset?:bool}` | `{success, operator}` / 404 | amiService.adjustOperatorCallsTaken / clearCallsTakenOverride (manual `fewestcalls` offset) |
| GET | `/api/queue/sync-settings` | 3535 | — | `{success, enabled, mode:'grandTotal'}` | amiService.queueDbSyncEnabled |
| POST | `/api/queue/sync-settings` | 3535 | `{enabled:bool}` | `{success, enabled, message}` | amiService.setQueueDbSyncEnabled |
| POST | `/api/queue/sync-now` | 3535 | — | `{success, message, count}` | amiService.syncAllFromDbNow |

### 1.15 Desktop agent (3CX desktop agent `agent.exe`; source not in the repo). Also reachable on port 3000.

| Method | Path | Auth | Request | Response | Svc / notes |
|---|---|---|---|---|---|
| POST | `/api/agent/heartbeat` | agent | `{operatorId, hostname?, appVersion?\|version?}` | `{success, timestamp, latestVersion, updateUrl}` | amiService.ensureOperatorExists. Sets op.agentConnected / lastAgentPing / agentHostname / agentVersion (offline after 38 s without a ping). WS `operators_update` and `agent_operators_update` when the agent comes online. |
| GET | `/api/agent/version` | none (no agent key) | — | `{success, latestVersion, updateUrl, releaseNotes, minVersion, lastReleaseTime}` | in-memory `agentReleaseConfig` (seeded from `3cx-desktop-agent/dist/version.txt`, default 1.0.4) |
| POST | `/api/agent/call-event` | agent | `{operatorId, eventType:(RINGING\|ANSWERED\|ENDED\|MISSED\|DIALLED\|OUTBOUND\|INFO), callerId, durationSec, startTime, endTime, hostname, details}` | `{success}` | dbService.recordAgentCallLog, resolveCallback, recordFailedOutboundAttempt, amiService.recordAgentCallEvent. WS `agent_operators_update`, `stats_update`, `callbacks_update`. |
| POST | `/api/agent/sync-batch` | agent | `{operatorId, hostname, calls:[{callerId, eventType, startTime, endTime, details, durationSec…}]}` (≤20000) | `{success, count:inserted}` / 413 | dbService.recordAgentCallLogsBatch (unique on op+caller+start). WS when inserted > 0. |
| POST | `/api/agent/update-log` | agent | `{operatorId, hostname, version, targetVersion, step:(DOWNLOADING\|DOWNLOADED\|INSTALLING\|SUCCESS\|ERROR\|INFO), message}` | `{success}` | in-memory ring buffer of 100. WS `agent_ota_log`. |
| POST | `/api/agent/reject` | agent | — | `{success, message:'Reject monitoring disabled'}` | stub. **dead** |
| POST | `/api/agent/release` | S-staff | `{version, releaseNotes?}` | `{success, message, config}` | Mutates the in-memory config (lost on restart). WS `agent_version_released`, `operators_update`. |
| GET | `/api/agent/update-logs` | S-staff | — | `{success, logs:[logEntry]}` | |
| GET | `/api/agent/status-all` | S-staff | — | `{success, releaseConfig, operators:[{id, name, exten, ip, agentConnected, agentHostname, agentVersion, lastPingSec, isLatest, latestVersion}]}` | |
| GET | `/api/agent/operator-stats` | S-staff | `?date` | `[AgentOperatorStats]` | dbService.getTodayAgentOperatorStats + issabelDbService.fetchOperatorStats for past dates |
| GET | `/api/agent/logs` | S-staff | `?page&limit(10-500)&operatorId&date=(today\|all\|YYYY-MM-DD)&search` | `{total, page, limit, totalPages, data:[{id, event_time, operator_id, caller_id, status, status_name, duration_sec, hostname, details,…}]}` (pretty-printed) | dbService.getAgentCallLogsPaginated |
| POST | `/api/agent/sync-from-cdr` | S-staff | `{date?}` | `{success, addedCount, message…}` | syncService.syncDailyCdrToAgentLogs (also runs automatically at 21:00 Tashkent). WS broadcasts on add. |
| GET | `/api/agent/sync-status` | S-staff | — | `{lastSyncTime, isSyncRunning}` | syncService.getLastSyncInfo |

### 1.16 System / Proxmox VMs (3535, S-staff; runs commands over SSH to Proxmox)

| Method | Path | Request | Response | Svc |
|---|---|---|---|---|
| GET | `/api/system/status` | — | `{success, timestamp, vms, autoRecover, services:{ami, sftp, redis:{name, connected, status}}, os:{platform, hostname, uptimeSec, cpu, memory,…}, process:{pid, nodeVersion, uptimeSec, memory…}, pm2, disk}` | systemService.getSystemMetrics |
| GET | `/api/system/vms` | — | `{success, vms:[{id, name, desc, status:'running'\|'stopped'\|'paused'\|'unknown'}]}` | proxmoxService.getVmsStatus |
| POST | `/api/system/vms/recover` | — | `{success, output, vms, lastRecovery}` / `{success:false, output, error, lastRecovery}` | proxmoxService.recoverAndStartAll('manual') (LVM repair + start Kerio/Issabel). WS `vm_recovery_event`. |
| GET | `/api/system/vms/auto-recover` | — | `{success, enabled, isRecovering, lastAttempt, lastOutput, lastRecovery}` | getAutoRecoverStatus |
| POST | `/api/system/vms/auto-recover` | `{enabled:bool}` | same | setAutoRecover |
| POST | `/api/system/vms/:vmid/start` | `:vmid` ∈ {101, 200} | `{success, output, vms}` | proxmoxService.startVm (`qm start`) |
| POST | `/api/system/vms/:vmid/stop` | `:vmid` ∈ {101, 200} | `{success, output, vms}` | proxmoxService.stopVm |

### 1.17 Converter / uzcrypto / export / speedtest / remote desktop

| Method | Path | App | Auth | Request | Response | Svc / notes |
|---|---|---|---|---|---|---|
| POST | `/api/converter/convert` | 3535 | S-staff (heavyLimiter) | `{filename\|fileName, targetFormat:(docx\|doc\|pdf\|txt\|png\|jpg\|jpeg\|webp), base64\|fileData (data-URL ok, ≤35 MB decoded)}` | `{success, filename, mimeType, size, base64:dataURL, fileData:dataURL}` | converterService.convertFile → `services/converter.py` (nothing is stored) |
| POST | `/api/converter/convert` | 3005 | V-any | same | proxied | 3005→3535 (operators included; the UI hides it for the 200-group) |
| GET | `/api/tools/uzcrypto/latest` | 3535, 3005 | none | `?force=true` | `{success, version, filename, windowsUrl, macosUrl, updatedAt, fallback?}` | uzcryptoService.resolveLatestUzcrypto (scrapes the vendor site). 3535 copy **unused?** |
| GET | `/api/tools/uzcrypto/download` | 3535, 3005 | none | `?os=(mac\|macos\|win…)` | 302 to the vendor URL (fallback `https://edo.ijro.uz/welcome`) | same |
| GET | `/api/export/excel` | 3535 | S-staff | `?month=YYYY-MM \| startDate&endDate, group\|operatorGroup=(all\|main\|100\|secondary\|200), lang\|language=(uz\|ru)` | `.xlsx` attachment | exportService.generateReportBuffer ("cal stat" template) |
| GET | `/api/speedtest/ping` | 3535, 3005 | 3535: S-staff; 3005: none | — | `{success, timestamp, clientIp, serverLanIp}` | 3535 copy **unused?** |
| GET | `/api/speedtest/download` | 3535, 3005 | same | `?bytes` (64 KB–60 MB, default 15 MB) | `application/octet-stream` | 3535 copy **unused?** |
| POST | `/api/speedtest/upload` | 3535, 3005 | same | raw body (body parsers may consume JSON/urlencoded bodies first; the client sends a blob) | `{success, bytesReceived, durationMs, mbps}` | 3535 copy **unused?** |
| GET | `/api/speedtest/operator-ping` | 3005 | none | `?ip` (must be 192.168.x.x or 10.x.x.x) | `{success, targetIp, avgPing, packetLoss, isOnline, verdict}` | `exec ping` on the server |
| POST | `/api/remote-desktop/launch` | 3535 | S-staff | `{ip}` | `{success, launched}` | Spawns `rustdesk.exe <ip>` **on the server host** (Windows paths). **unused?** |
| POST | `/api/remote-desktop/notify-operator` | 3005 | V-any | `{operatorId, operatorName}` | `{success}` | WS `remote_install_prompt` to **all** viewer sockets |
| GET | `/api/remote-desktop/devices` | 3005 | V-any | — | `{success, devices:[{ext, ip, hostname, installed, updatedAt}]}` | `viewer/data/rustdesk_devices.json` |
| POST | `/api/remote-desktop/report-installed` | 3005 | none | `{ip?, ext?, hostname?, installed=true}` | `{success, device}` | Called by `public/downloads/RustDesk_Ornatish.bat`. WS `rustdesk_device_status`. |
| POST | `/api/remote-desktop/toggle-device` | 3005 | V-any (no role check) | `{ext?, ip?, installed:bool}` | `{success}` | WS `rustdesk_device_status` |

### 1.18 Tickets (3005 only; JSON file `viewer/data/tickets.json`; attachments in `viewer/public/uploads/tickets/`, **served without auth**)

All routes are V-any. **Identity in the body (`operatorId`, `editorId`) is trusted.** Only create uses the session.

| Method | Path | Request | Response | Svc / notes |
|---|---|---|---|---|
| GET | `/api/tickets` | `?filter=(all\|mine\|pending\|in_progress\|completed\|rejected)&operatorId` (falls back to session operatorId; **query wins**) | `{success, total, stats:{total, mine, pending, in_progress, completed, rejected}, data:[Ticket]}` | ticketService.getTickets. 200+ see tickets created by 200+; 100–199 see tickets targeted to them or `all`; others see everything. |
| GET | `/api/tickets/:id` | — | `{success, data:Ticket}` / 404 | getTicketById. **unused?** |
| POST | `/api/tickets` | `{customerPhone?, title?, comment?, files?:[{base64, name}], isUrgent?, targetOperatorId?('all'), targetOperatorName?, creatorId?, creatorName?}` | 201 `{success, data:Ticket}` / 400 / 403 | ticketService.createTicket. The creator is the session operatorId, else body, else `'200'`. 403 for 100–199 and for username `maxmudbek`; IDs < 200 are coerced to `'200'`. WS `ticket_created`. |
| PUT | `/api/tickets/:id` | `{editorId?, editorName?, customerPhone?, comment?, isUrgent?, targetOperatorId?, targetOperatorName?}` | `{success, data}` / 400 | updateTicket. Creator-only check runs **only if `editorId` is sent**. WS `ticket_updated`. |
| POST | `/api/tickets/:id/edit` | same | same | alias. **unused?** |
| POST | `/api/tickets/:id/accept` | `{operatorId, operatorName}` | `{success, data}` | acceptTicket → `in_progress`. checkOperatorPermission (target, creator, `'admin'` or `'superuser'` literal IDs). WS `ticket_accepted`. |
| POST | `/api/tickets/:id/complete` | `{operatorId, operatorName}` | `{success, data}` | completeTicket → `completed`. WS `ticket_completed`. |
| POST | `/api/tickets/:id/reject` | `{operatorId, operatorName, reason?}` | `{success, data}` | rejectTicket → `rejected`, adds a system comment. WS `ticket_rejected`. |
| POST | `/api/tickets/:id/comments` | `{operatorId, operatorName, text?, files?}` | `{success, data:Ticket, comment}` | addTicketComment. WS `ticket_comment_added`. |
| DELETE | `/api/tickets/:id` | — | `{success}` / 404 | deleteTicket (**no ownership check**). WS `ticket_deleted {id}`. |
| POST | `/api/tickets/cleanup` | — | `{success, data:{removedCount, remainingCount}}` | manualCleanupCompleted (also runs automatically every Monday). WS `tickets_cleaned`. |
| GET | `/api/tickets/preview-doc` | `?file\|url\|fileName` | — | **Shadowed** by `GET /api/tickets/:id` (registered earlier), so it returns 404 "Ticket topilmadi". **dead** |
| POST | `/api/tickets/preview-doc` | `{base64?, filename?}` or `{file\|url\|filename}` | `{success, html, …}` | ticketService.renderDocxBase64ToHtml / renderDocxToHtml (mammoth). An absolute path reads any `.docx` on the server. |

`Ticket = {id:'TK-####', creatorId, creatorName, creatorIp, customerPhone, title, comment, files:[{url:'/uploads/tickets/…', fileName, …}], isUrgent, targetOperatorId, targetOperatorName, status:(pending|in_progress|completed|rejected), acceptedBy, completedBy, rejectedBy:{id, name, at, reason?}, createdAt, updatedAt, comments:[…]}`

### 1.19 Viewers / presence (3005)

| Method | Path | Auth | Response | Notes |
|---|---|---|---|---|
| GET | `/api/viewers/active` | V-any | `{count, totalTabs, viewers:[{ip, isOperator, id?, exten?, name, tabsCount, connectedAt}]}` | Grouped by operatorId, else by username+ip, else by ip. |
| GET | `/api/viewers/history` | superuser | `{success, count, totalTracked, data:[{id, ip, username, role, operatorId, operatorName, connectedAt, disconnectedAt, durationSeconds, status, userAgent}]}` (last 300, newest first) | `viewer/data/viewer_history.json` (capped at 500) |

### 1.20 Telegram form proxy & internal endpoints

| Method | Path | App | Auth | Behaviour |
|---|---|---|---|---|
| ALL | `/telegram-form/*` | 3535, 3005 | **none** (mounted before every auth layer and before the HTTPS redirect) | Reverse proxy to `127.0.0.1:3006` (service not in the repo). Strips `x-frame-options` and `content-security-policy` from the response. 502 when the upstream is down. The 3535 copy is **unused?**; the viewer UI links to it. |
| POST | `/api/internal/invalidate-sessions` | 3005 | internal (loopback + `x-internal-token` + no XFF; timing-safe compare) | `{username?}` → clears the session cache for that user, or all users. Sends `session_terminated` and closes 4001 the matching viewer WS. Called by 3535 on admin password reset. |
| POST | `/api/internal/voice-scan-sync` | 3535 | S-staff / internal (no dedicated check) | See §1.12. |
| — | internal header contract | 3005→3535 | — | 3005 sends `x-internal-token` on all proxied REST calls and on its upstream WS, plus `x-acting-user` on callback deletes. Session checks use the user's own Bearer token (`/api/auth/me`, `/api/auth/logout`, webauthn, `/api/settings/sessions`). |

### 1.21 SPA / page routes

| App | Paths | Behaviour |
|---|---|---|
| 3535 | `/`, `/dashboard`, `/explorer`, `/audio`, `/operators`, `/operator`, `/history`, `/clients`, `/customers`, `/mijozlar`, `/statistics`, `/statistika`, `/analytics`, `/tools`, `/converter`, `/asboblar` | S-staff → `public/index.html` (no-store). Username `superuser` on `/statistics`, `/statistika`, `/analytics` → 302 `/`. Catch-all also serves `index.html`. |
| 3535 | `/login`, `/logout`, `/viewer(s)`, `/operator(s)` | see §1.1 |
| 3535 | static `public/` (after the gateway, except the whitelisted asset prefixes), `/.well-known/*` (ACME) | |
| 3005 | `/tickets`, `/tickets.html` | `tickets.html` (V-any) |
| 3005 | `/guide`, `/guide.html`, `/manual`, `/manual.html`, `/yoriqnoma` | `guide.html` (none) |
| 3005 | `/downloads/*` | static from `../public/downloads` or `/opt/call-center/public/downloads` (none): agent.exe, rustdesk.exe, 3CXPhone msi, bat scripts |
| 3005 | everything else | `index.html` (V-any) |

---

## 2. WebSocket

### 2.1 Connection & auth

| | 3535 | 3005 |
|---|---|---|
| URL | `ws(s)://<host>:3535/`. Any path is accepted (`noServer`, no path check). | `ws(s)://<host>:3005/`. The main UI uses `/`; `tickets.html` uses `/ws`. Any path works. |
| Rate guard | `canAcceptWebSocket`: >15 concurrent per external IP → raw `429` | same |
| Auth on upgrade | 1) **internal**: loopback + no XFF + `x-internal-token` → accepted as `{username:'internal-viewer', role:'system'}`. 2) Otherwise the token comes from cookie `cc_session` or `Bearer`. Invalid → `401`; **role `operator` → `403`**. | Token from Bearer, cookie `cc_viewer_session`/`cc_session`, or `?token=` → validated via 3535 `/api/auth/me` (60 s cache). Invalid → `401`. **Any role.** `maxPayload` 15 MB. |
| After connect | `ws.user` is reset to null and re-derived from the token. If no username is found, it falls back to **the most recent unexpired session whose IP matches `%<clientIp>%`** (display only). Assigns `clientId`, a cursor colour and `suggestedPcName`. Awaits `amiService.ensureInitialSync()`, then sends `initial_state`, `server_version`, `client_assigned`, then broadcasts `presence_stats`. | Records the socket in `connectedViewers` with `{ip, operatorId (session, else IP map), operatorName, operatorLocked:=session has operatorId, username, role}`. Appends to the viewer history file. Sends `client_identity`, its own `server_version`, `active_viewers_update`, then broadcasts `active_viewers_update`. **Opens one upstream WS to 3535 per client** (internal token) and relays it. |
| Keepalive | none | protocol ping every 30 s (dead sockets terminated); app-level `server_ping` every 15 s |
| Kick | close code `4001` after `session_terminated` (password reset) | close `4001` after `session_terminated` (`/api/internal/invalidate-sessions`). If the upstream closes, the client socket is closed. |

**Envelope.** Messages emitted through `amiService.broadcast(type, data)` are `{type, data, timestamp:ISO}`. Messages sent through `broadcastWs` or directly in app.js are `{type, data}` with no timestamp. Ticket events are `{type, data, timestamp:ms}`. Some viewer messages are **not** wrapped in `data` (noted below).

### 2.2 Server → client messages, 3535 (also relayed to every 3005 client unless filtered; see §2.4)

| type | Payload | When / emitter |
|---|---|---|
| `initial_state` | `data:{serverVersion{buildId, buildTime, version, app}, amiStatus:bool, sftpStatus:bool, stats:SummaryStats, queueStrategy:string, activeChannels:[Channel], conversations:[Conversation], queues:[QueueSummary], excludedOperators:[id], operators:[Operator], callHistory:[CallRecord] (50), callbacks:[Callback], contacts:[Contact] (ALL), clientId, suggestedPcName, cursorColor}` | on connect (direct) |
| `server_version` | `data:{buildId, buildTime, version, app}` | on connect |
| `client_assigned` | `data:{clientId, suggestedPcName, color}` | on connect |
| `presence_stats` | `data:{onlineCount (≥1), users:[PresenceUser{clientId, deviceId, pcName, username, role, clientIp, color, tab, isActive, isVisible, lastActiveAt, operator:{id, name, agentHostname}\|null}]}`. Counts only 3535 dashboard sockets, deduplicated by deviceId (or by IP+pcName). | on connect, on `presence_ping`, on close. Sent to **all** sockets. |
| `remote_cursor_move` | `data:{clientId, deviceId, xRatio, contentY, tab, x, y, pcName, color}` | client `cursor_move`. Sent to all other sockets except those with the same deviceId. |
| `remote_cursor_remove` | `data:{clientId}` | client `cursor_leave` or socket close |
| `session_terminated` | `{type, message}` (no `data`) | `PUT /api/settings/users/:u/password`, followed by close 4001 |
| `sftp_status` | `data:{connected}` | SFTP state change |
| `vm_recovery_event` | `data:{status:'started'\|'success'\|'failed', data:lastRecovery{startTime, endTime, durationSec, status, trigger, stoppedVms, output…}}` | proxmoxService recovery (manual or auto). **No frontend handles it.** |
| `callbacks_update` | `data:[Callback]` | callback DELETE/sync, agent call-event, AMI hangup/abandon events, periodic Issabel sync (amiService ~5 s loop, full sync every 30 min) |
| `client_contacts_update` | `data:{action:'upsert', contact:Contact}` or `{action:'delete', phone}` | `POST/DELETE /api/contacts` |
| `operators_update` | `data:[Operator]` | AMI events (peer/queue member/bridge/hangup), pause, heartbeat, exclude-list, agent timeout watchdog, periodic sync, midnight rollover, calls-taken adjust |
| `excluded_operators_update` | `data:[id]` | `POST /api/settings/exclude-list` |
| `stats_update` | `data:SummaryStats` | AMI events, agent events, periodic sync |
| `call_history_sync` | `data:[CallRecord]` (50, **includes `recording` path**) | periodic Issabel CDR sync |
| `call_hangup` | `data:CallRecord{id, channel, uniqueid?, callerId, operator, operatorExten, direction, status:(ANSWERED\|ABANDONED\|NO ANSWER), hangupParty, duration, waitSec, cause, time}` | AMI AgentComplete / QueueCallerAbandon / Hangup |
| `ami_status` | `data:{connected:true, host}` or `{connected:false, error?}` | AMI connect/close/error |
| `queue_strategy_update` | `data:{strategy, queue}` | queue strategy change. **No frontend handles it.** |
| `queue_update` | `data:[QueueSummary]` | QueueStatus cycles / recalculation |
| `active_conversations_update` | `data:[Conversation]` | bridge/hangup/recalculateConversations |
| `agent_operators_update` | `data:[AgentOperatorStats]` | agent heartbeat (newly online), call-event, sync-batch, sync-from-cdr, agent state change, 21:00 sync |
| `agent_version_released` | `data:{latestVersion, updateUrl, releaseNotes, minVersion, lastReleaseTime}` | `POST /api/agent/release`. **No frontend handles it** (presumably for agents, but agents use HTTP). |
| `agent_ota_log` | `data:{id, time, operatorId, operatorName, hostname, version, targetVersion, step, message, icon}` | `POST /api/agent/update-log` |

### 2.3 Server → client messages, 3005-originated

| type | Payload | When |
|---|---|---|
| `client_identity` | `data:{ip, operatorId, operatorName, operatorLocked, username, role}` | on connect |
| `server_version` | `data:` viewer version (the 3535 one is dropped) | on connect |
| `active_viewers_update` | `data:{count, totalTabs, viewers:[…]}` (same as `/api/viewers/active`) | connect, close, `register_operator`, watchdog purge |
| `server_ping` | `{type, time}` (no `data`) | every 15 s |
| `session_terminated` | `{type, message}` | `/api/internal/invalidate-sessions`, then close 4001 |
| `help_request_status` | `data:{requestId, status:'offline', toId, toName, message}` or `{requestId, status:'ringing', toId, toName, hasVoice, hasText}` | to the caller after `help_request` |
| `incoming_help_request` | `data:{requestId, fromId, fromName, toId, toName, audioBase64\|null, durationSec, hasVoice, textMessage\|null, timestamp}` | to every socket of target `toId` (matched by registered operatorId or IP map) |
| `help_response_received` | `data:{requestId, fromId, toId, toName, accepted, timestamp}` | to every socket of `fromId` |
| `help_cancelled` | `data:{requestId, fromId, toId}` | to target sockets |
| `remote_install_prompt` | `{type, operatorId, operatorName}` (**top-level, no `data`**) | `POST /api/remote-desktop/notify-operator`, to **all** sockets (the client filters) |
| `rustdesk_device_status` | `{type, device:{ext, ip, hostname?, installed, updatedAt?}}` (**no `data`**) | report-installed / toggle-device, to all |
| `ticket_created`, `ticket_updated`, `ticket_accepted`, `ticket_completed`, `ticket_rejected` | `{type, data:Ticket, timestamp}` | ticket REST actions, to **all** viewer sockets (no group filtering) |
| `ticket_comment_added` | `data:{ticket, comment}` | |
| `ticket_deleted` | `data:{id}` | |
| `tickets_cleaned` | `data:{removedCount, remainingCount}` | |

### 2.4 Viewer relay filtering (3535 → 3005 client)

| Upstream type | Viewer handling |
|---|---|
| `server_version` | dropped |
| `initial_state` | `serverVersion` deleted; `sftpStatus` forced to `false`; `callHistory` passed through `sanitizeCalls` (removes `recording`, `recordingfile`, `uniqueid_clean`); `operators` copied into the IP→operator cache. **`contacts` is NOT filtered**, so the full phone book reaches 200-group operators, who are blocked from it over REST. |
| `operators_update`, `agent_operators_update` | relayed; also refresh the IP→operator cache |
| everything else | relayed verbatim. This includes `call_history_sync` (**with recording paths**, unsanitized), `presence_stats` (admin usernames and IPs), `client_contacts_update`, `remote_cursor_*`, `agent_ota_log`. |

### 2.5 Client → server messages

| type / action | App | Payload | Effect |
|---|---|---|---|
| `{action:'refresh_channels'}` | 3535 (also forwarded from 3005) | — | amiService.pollQueueAndChannels() |
| `{action:'sync'}` | 3535 | — | sent by the dashboard "Sync" button; **ignored by the server (dead)** |
| `cursor_move` | 3535 | `{deviceId, tabId, xRatio, contentY, tab, pcName, [x, y, username, role, color]}` | sets `appType='dashboard_3535'`, active/visible, and **trusts client-sent `username`/`role` for display**; broadcasts `remote_cursor_move` |
| `presence_ping` | 3535 | `{appType:'dashboard_3535', deviceId, tabId, isActiveTab, isVisible, pcName, tab, username, role}` | updates presence; broadcasts `presence_stats` |
| `cursor_leave` | 3535 | — | broadcasts `remote_cursor_remove` |
| `register_operator` | 3005 (local) | `{data:{operatorId, operatorName}}` | sets the socket's operator identity unless `operatorLocked` (the session has an operatorId); updates history; broadcasts `active_viewers_update` |
| `help_request` | 3005 (local) | `{data:{requestId, fromId, fromName, toId, toName, audioBase64?, durationSec, hasVoice, textMessage?}}` | routes to the target (see 2.3). **`fromId` is client-supplied and spoofable; the 200-group restriction is enforced client-side only.** |
| `help_response` | 3005 (local) | `{data:{requestId, fromId, toId, toName, accepted:bool}}` | → `help_response_received` to `fromId` |
| `help_cancel` | 3005 (local) | `{data:{requestId, fromId, toId}}` | → `help_cancelled` to `toId` |
| anything else | 3005 | any | forwarded verbatim to the upstream 3535 WS (so a viewer client can send `refresh_channels`, `cursor_move` or `presence_ping` to 3535) |

### 2.6 Shared payload shapes

| Name | Key fields |
|---|---|
| `Operator` | `id, name ("Real (id)"), realName, presence:(ready\|ringing\|talking\|paused\|offline), ip, latency, totalCalls, answered, outbound, transferredOut, transferredIn, transferResolved, grandTotal(=answered+outbound+transferResolved), denied, missed, totalDurationSec, avgDurationSec, ringingCaller, ringingSince, talkingSince, paused, agentConnected, agentHostname, agentVersion, lastAgentPing, callsTaken, callsTakenOverride, queueDbSync, lastCall, queuePosition, penalty, clientHangup, operatorHangup` (excluded operators filtered out; sorted by presence weight, then id) |
| `AgentOperatorStats` | `id, name, realName, presence, talkingSince, paused, grandTotal, ip, latency, ringingCaller, agentConnected, agentHostname, agentVersion, lastAgentPing, answered, callsTaken, lastCall, outbound, transferredOut, transferredIn, transferResolved, missed, totalDurationSec, avgDurationSec, totalCalls` |
| `SummaryStats` | `totalCalls, inboundCalls, outboundCalls, answeredCalls, abandonedCalls, abandonedPendingCalls, abandonedUnreachableCalls, abandonedResolvedCalls, callbacksPendingCount, callbacksUnreachableCount, callbacksResolvedCount, totalAbandonedClients, uniqueClients, inboundClients, outboundClients, answeredClients, totalClients, queueClients, missedClients, deniedCalls, missedCalls, clientHangupCalls, operatorHangupCalls, answerRate, abandonedRate, outboundRate, denyRate, missedRate, totalDurationSec, activeCount, operatorCount, queueWaitingTotal, hourlyChart:{labels[08:00..21:00], inbound[], answered[]}, queueStrategy` |
| `CallRecord` | `id, time, callerId, operator, operatorExten, direction:(inbound\|outbound\|transfer), status, hangupParty, duration, waitSec, recording?, cause?, channel?, uniqueid?, source?` |
| `Conversation` | `key, callerId, operator, operatorExten, state, stateType:'talking'\|…, direction, channel, startTime, duration` |
| `Channel` | `channel, callerId, callerName, extension, context, application, state, direction, dialedPhone, startTime, answeredTime, operator` |
| `QueueSummary` | `name, strategy, callsWaitingCount, callersWaiting:[{callerId, clientName, clientOrg, position, channel, waitSec, queueName}]` (or raw AMI queue objects) |
| `Callback` | `pending_callbacks` row `{id, phone, caller_name, source:(abandoned\|manual), call_time, attempts_count, today_attempts, status:(pending\|resolved\|dismissed), dismissed_at, dismissed_by, notes, created_at, updated_at}` + `activeCall` (live call or null) |
| `Contact` | `{phone, name, organization, notes, language, telegram_user_id, created_at, updated_at}` |

---

## 3. Endpoints that look dead or unused by the frontends

Checked by grepping `legacy/public/js/*.js`, `legacy/public/*.html`, `legacy/public/tools/*.html`, `legacy/viewer/public/js/*.js`, `legacy/viewer/public/*.html` and `legacy/viewer/public/tools/*.html`. "Agent" endpoints are used by `agent.exe`, whose source is not in the repo, so they cannot be verified and are not listed.

| App | Endpoint(s) | Status |
|---|---|---|
| 3535 | `POST /api/db/query` (410), `POST /api/agent/reject` (stub), `PUT /api/auth/profile/email` (always 403) | dead |
| 3535 | All voice-ID routes (§1.12, 17 routes); the orchestrator and Python scripts are missing | unused? |
| 3535 | `POST /api/auth/change-password` | unused? (no UI calls it) |
| 3535 | `GET /api/channels`, `GET /api/db/summary`, `GET /api/db/operators` | unused? |
| 3535 | `GET/POST /api/recordings/download-zip`, `GET /api/recordings/range-count`, `GET/POST /api/recordings/download-range-zip` (replaced by zip-jobs) | unused? |
| 3535 | `GET /api/recordings/index-status`, `GET /api/recordings/transcribed-list`, `GET /api/recordings/transcribe` (the UI uses POST) | unused? |
| 3535 | `POST /api/action/originate` (swagger only) | unused? |
| 3535 | `PUT /api/settings/users/:u/email`, `…/operator-id`, `…/role` (the UI only does create, password reset and delete) | unused? |
| 3535 | `GET /api/contacts/:phone` | unused? |
| 3535 | `POST /api/remote-desktop/launch` | unused? |
| 3535 | `/api/speedtest/*`, `/api/tools/uzcrypto/latest` (the viewer UI uses the 3005 copies) | unused? |
| 3535 | `/api-docs`, `/swagger`, `/api/docs-json` | dev only |
| 3535 | `/telegram-form` (only the viewer UI links it) | unused? on 3535 |
| 3005 | `GET /api/tickets/preview-doc` (shadowed, returns 404) | dead |
| 3005 | `POST /api/operator/pause` (403 stub), `PUT /api/auth/profile/email` (always 403 upstream) | dead |
| 3005 | `GET /api/tickets/:id`, `POST /api/tickets/:id/edit` | unused? |
| 3005 | `DELETE /api/callbacks/:id`, `DELETE /api/callbacks` | unused? (viewer UI is read-only) |
| 3005 | `GET /api/contacts/top-active`, `GET /api/contacts/:phone`, `GET /api/status`, `GET /api/calls/recent` | unused? |
| 3005 | `GET /api/security/stats`, `POST /api/security/unjail` | unused? |
| 3005 | `POST /api/remote-desktop/report-installed` | used by `RustDesk_Ornatish.bat`, not by the UI |
| 3005 (broken) | Viewer UI calls `GET /api/settings/exclude-list` (viewer.js:39), but **3005 has no such route**: it gets `index.html`, JSON parsing fails silently, and the excluded-operator cache stays empty | broken call |
| WS | `{action:'sync'}` (client), plus `vm_recovery_event`, `queue_strategy_update`, `agent_version_released` (server; no handler in either UI). The 3535 `session_terminated` is not handled by the dashboard (only the close code matters). | unused? |
| Limiter | `heavyLimiter` on `/api/export-excel` and `/api/download-recordings-zip` (non-existent paths) | dead config |

---

## 4. Role / permission matrix

"Server" means enforced by the backend. "UI" means hidden in the frontend only. The 200-group is defined as `parseInt(session.operatorId) >= 200` ("Zangiota"); 100–199 is the "Asosiy" main group. The username `maxmudbek` is treated as admin-like by the viewer UI and as a 100-group member for ticket creation.

| Capability | Operator 100–199 | Operator 200+ | admin | superuser |
|---|---|---|---|---|
| 3535 dashboard pages, API (S-staff) and WS | ✗ (server: 403/redirect to 3005; WS 403) | ✗ | ✓ | ✓ |
| 3535 pre-gateway auth routes (me, logout, change-password, profile email, passkeys, forgot-password), `/api/presence/online-users` | ✓ | ✓ | ✓ | ✓ |
| 3005 portal + WS relay of live state (operators, conversations, callbacks, stats via WS) | ✓ | ✓ | ✓ | ✓ |
| Contacts via 3005 (list / get / create / delete) | ✓ (server) | ✗ (server: empty list / 403; UI hides). **Leak: full contacts still arrive in WS `initial_state`.** | ✓ | ✓ |
| Callbacks: view | ✓ (3005 GET) | ✓ | ✓ | ✓ |
| Callbacks: dismiss one / all | ✗ (3005 server: admin+) | ✗ | ✓ (on 3535 only the gateway applies) | ✓ |
| Blacklist | only with the blacklist password (via 3005 proxy) | same (UI may hide; no server check) | password + session | password + session |
| Pause/unpause operators, transfer, hangup, originate, adjust-calls, queue DB sync | ✗ (3005 has no proxy / 403 stub) | ✗ | ✓ | ✓ |
| Recordings, STT, ZIP export, history, stats REST, Excel export | ✗ (not proxied; `sanitizeCalls` strips audio from REST and from `initial_state`). **Leak: the relayed WS `call_history_sync` carries `recording` paths.** | ✗ | ✓ | ✓ |
| Topic analytics (`/api/analytics/*`, `/statistics` page) | ✗ | ✗ | ✓ | ✓ by role, but **the account named `superuser` gets 403** (server) and the statistics/tools tabs are hidden (UI) |
| Converter | ✓ (via 3005 proxy) | server ✓, UI hides (`converter`, `ijro_letter`, `rustdesk-setup` tools hidden) | ✓ | ✓ |
| Tickets: create | ✗ (server 403) | ✓ (creator) | ✓ (creator = body `creatorId` or `'200'`) | ✓ |
| Tickets: accept/complete/reject | only if target or creator, **checked against body `operatorId` (spoofable)** | same | same (or literal `'admin'` / `'superuser'` IDs) | same |
| Tickets: list visibility | targeted to self or `all` | created by any 200+ | all (no operatorId) | all |
| Tickets: delete / cleanup / edit without `editorId` | ✓ (no server check) | ✓ | ✓ | ✓ |
| Remote desktop (RustDesk) buttons, notify-operator, toggle-device | ✓ | ✗ UI only (server allows any session) | ✓ | ✓ |
| Help request ("ring") over WS | ✓ to 100-group | ✗ UI only (blocked if either side is 200+; server relays anything) | ✓ | ✓ |
| Viewer access history `/api/viewers/history` | ✗ | ✗ | ✗ (server: superuser only) | ✓ |
| Active sessions list/kill (`/api/settings/sessions`, `/api/viewer/sessions`) | ✗ | ✗ | ✓ | ✓ |
| Users / RBAC (create, reset password, change role, delete), lockouts, security settings, exclude-list | ✗ | ✗ | ✓ (**same as superuser; can create or promote superusers**) | ✓ (last superuser cannot be demoted or deleted) |
| Anti-DDoS stats / unjail / simulate-flood | ✗ | ✗ | ✓ | ✓ |
| Proxmox VMs, system status, agent OTA release | ✗ | ✗ | ✓ | ✓ |
| Passkeys | own | own | own + list/delete others' | own + list/delete others' |
| Dev visual-prompt inbox | ✗ | ✗ | ✗ | ✓ (and `ENABLE_DEV_INBOX=true`) |
| Operator impersonation in the dashboard | — | — | UI-only (`sessionStorage`), no server effect | UI-only |

### Ambiguities and points to decide in the rewrite (do not copy them blindly)

- `requireSuperuser` accepts `admin`, so the server makes no admin/superuser distinction except: dev inbox, viewer history, and the username-based analytics block. Decide whether admin should be able to manage users and promote to superuser.
- Viewer operator identity can come from the **client IP map** (`operatorIpMap`, hard-coded office IPs plus live SIP IPs) when the session has no `operatorId`. Any user at an operator's PC gets that operator's identity in `/api/auth/me`, WS `client_identity` and help routing.
- Ticket identity fields come from the request body. Delete and cleanup have no authorization. `/uploads/tickets/*` is public.
- 3535 trusts the viewer's internal token for every S-staff route. The viewer therefore *is* the operator-permission layer, and anything it proxies is reachable by every role unless the viewer checks it (only callbacks-delete and the contacts 200-group check exist).
- Several viewer-side role checks (`checkIs200Operator`) rely on `session.operatorId`. An operator account whose operatorId was cleared via `PUT …/operator-id` loses all 200-group restrictions.
- `/api/auth/me` on 3535 returns the session token in the JSON body. `/login`, `/viewer` and the operator redirects put the token in the URL query string.

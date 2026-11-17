# Legacy Frontend — Functional Inventory (for the React + TS rewrite)

Scope: everything a user can see or do in the legacy UI, screen by screen, so the new SPA can reach parity.
All paths are relative to `legacy/`. `dashboard.js` = `public/js/dashboard.js`, `viewer.js` = `viewer/public/js/viewer.js`, `tickets.js` = `viewer/public/js/tickets.js`, `index.html` = `public/index.html` unless prefixed with `viewer/`.
UI language in code is Uzbek (Latin); English glosses are given in parentheses where it helps.

---

## 0. Topology at a glance

| | Admin dashboard | Operator portal ("Viewer") |
|---|---|---|
| Server / port | `app.js`, **3535** | `viewer/app.js`, **3005** |
| Page shell | `public/index.html` (6.3k lines) + `dashboard.js` (16.7k) | `viewer/public/index.html` (3.4k) + `viewer.js` (7.1k) + `tickets.js` (2.5k) |
| Routing | Client-side tab router, `history.pushState` (`dashboard.js:648-767`); server serves `index.html` for a fixed alias list (`app.js:4004`) | SPA fallback: any unknown path returns `index.html` (`viewer/app.js:2230`); `/tickets` is a separate page |
| Auth | Own sessions (`cc_session` HttpOnly cookie or `Authorization: Bearer`) (`services/authService.js:1326`) | Validates token against 3535 (`validateSessionWithUpstream`), accepts `?token=` once and converts it to a cookie (`viewer/app.js:369-381`) |
| WebSocket | `ws(s)://host:3535/` | `ws(s)://host:3005/` — relays the 3535 stream and adds its own events (`viewer/app.js:899-1060`); tickets page uses `/ws` |
| Login page | `/login` (served only by 3535) | None of its own. Unauthenticated users go to `https://<host>:3535/login` (`viewer/app.js:386-401`) |

The rewrite target is one SPA with role-based routes. Both legacy UIs share look, components (operator cards, callbacks list, detail modal, profile/Gmail modal) and many duplicated helpers. In the rewrite they should be one component set.

---

## 1. Navigation map

### 1.1 Admin SPA (port 3535)

Tabs live in the header (`index.html:273-349`) and in a mobile bottom nav (`index.html:6266-6330`). The active tab is set before paint by an inline script (`index.html:26-33`) and kept in `html[data-tab]`. CSS shows and hides sections from that attribute (`index.html:36-112`).

| URL (aliases) | Tab id / label | Section anchor | Notes |
|---|---|---|---|
| `/`, `/dashboard` | `dashboard` — "Dashboard" | `index.html:708` | Default. The logo click (`navigateToHome`, `dashboard.js:769`) returns here or scrolls to top |
| `/operators`, `/operator` | `operators` — "Operatorlar" | `index.html:1527` | Export button is visible **only** on this tab (`index.html:124-130`) |
| `/history` | `history` — "Qo'ng'iroqlar Tarixi" (Call history) | `index.html:1779` | |
| `/explorer`, `/audio` | `explorer` — "Audio Explorer" | `index.html:1254` | |
| `/clients`, `/customers`, `/mijozlar` | `clients` — "Mijozlar" (Clients) | `index.html:2057` | |
| `/statistics`, `/statistika`, `/analytics`, `/tools`, `/converter`, `/asboblar` | `statistics` — "Statistika" | `index.html:2206` | `/tools` and `/converter` map to statistics (`dashboard.js:660-666`). The converter UI no longer exists on 3535 (see §7) |
| `/login` | Login page | `public/login.html` | A valid session redirects away (operator → 3005, others → `/`) (`app.js:342-354`) |
| `/logout` | — | — | Clears the cookie, redirects to `/login` (`app.js:410-420`) |
| `/viewer`, `/viewers` | — | — | Redirects to `:3005/?token=…` (`app.js:357-362`) |
| `/guide.html` | Static "systems & roles tree" page | `public/guide.html` | No nav link on 3535 |
| `/tools/managers.html` | Static directory of responsible staff | `public/tools/managers.html` | No nav link on 3535. The viewer links its own copy |
| `/api-docs`, `/swagger` | Swagger UI | — | Developer only |

Header extras on all tabs: logo with a hidden "Server status" button; a "gooey" burger menu with Server status, language toggle and Profile (`index.html:364-524`); the global date filter bar (§2.A); the presence widget; Export.

### 1.2 Operator portal (port 3005)

| URL | Page | Notes |
|---|---|---|
| `/` (and any unknown path) | Viewer main: callbacks, operator grid, tools zones, ticket sidebar | `viewer/public/index.html` |
| `/tickets`, `/tickets.html` | Full-page ticket board ("KDS doskasi") | `viewer/public/tickets.html` (`viewer/app.js:1974`) |
| `/guide`, `/guide.html`, `/manual`, `/manual.html`, `/yoriqnoma` | Systems & roles focus tree | Same file as admin `guide.html` (`viewer/app.js:1979`); public, no auth |
| `/tools/managers.html`, `/tools/uzb2026.html` | Static tool pages, opened in a new tab or in an iframe modal | Public (`/tools/` is whitelisted, `viewer/app.js:360`) |
| `/telegram-form` | Reverse proxy to a separate Telegram-form app | `viewer/app.js:183`. Out of scope, but linked from the tools grid |
| `/logout` | Clears the cookies, redirects to 3535 `/login` | `viewer/app.js:275-291` |

### 1.3 Roles and what each one sees

Roles from the backend: `superuser`, `admin`, `operator` (`app.js:278, 727`). The "Create user" form offers only `operator` and `superuser` (`index.html:5631-5634`). `admin` exists server-side but cannot be created from the UI.
The client also splits operators by **extension number**: main group 100–199, and the "Zangiota 42" group with ext **200+**. That is the "200-group".

| Capability | superuser, username `superuser` ("Boss") | superuser / admin (others) | operator 100–199 | operator 200+ ("Zangiota") |
|---|---|---|---|---|
| 3535 admin SPA | Yes, **without the Statistika tab**: link hidden, route forced to dashboard (`dashboard.js:686-691`, `13822-13833`) | Yes, all tabs | No. Server 302s pages to 3005; APIs return 403 (`app.js:1190-1216`) | No |
| After login | Panel-choice modal: Admin (3535) or Operators (3005) (`login.html:1738-1743`, `1441`) | Same | Straight to 3005 | Straight to 3005 |
| Settings modal (security, exclude list, users, sessions) | Yes (`requireSuperuser` accepts both roles, `app.js:724`) | Yes | — | — |
| Viewer "Tarix" (viewer access history) button | Only `role === 'superuser'` (`viewer.js:2462`) | admin: no | No | No |
| Viewer tools hidden | none | none | none | `ijro_letter`, `rustdesk-setup`, `converter` (`viewer.js:2245-2280`) |
| RustDesk remote button and "help ring" bell on operator cards | Yes | Yes | Yes, except toward 200+ targets | No (`viewer.js:1076`, `3455-3462`) |
| Add/edit client contact from the viewer | Yes | Yes | Yes | No (`is200ContactRestricted`, `viewer.js:4213`) |
| Default operator-group tab in the viewer | main | main | main | `secondary` (`viewer.js:52-62`) |
| Tickets: create | Only if username is `superuser` and not bound to an operator | — | **No.** Receivers only (`tickets.js:897-930`) | **Yes.** Creators |
| Tickets: accept, complete, reject | Yes | Yes | If assigned to me, to "all", or I created it (`tickets.js:740-742`) | Their own |
| Tickets: edit, delete | Yes | Yes | Creator only | Creator only |
| Ctrl+; impersonation modal | Works. The token list comes from `/api/settings/sessions` | Works | Opens, but the list request returns 403 | Same as 100–199 |

**Rewrite note.** The legacy client decides roles from string heuristics: username contains digits ≥200, contains `zangiota`, equals `maxmudbek`; operator id from `localStorage`. The new SPA should take `role`, `operatorId` and `group` as claims from `/api/auth/me` and gate routes on them.

---

## 2. Screens

### 2.A Admin shell (common to all 3535 tabs)

| Block | Details | Source |
|---|---|---|
| Global date filter bar | Calendar popup (Windows 11 style) with a live clock, native date input, month nav, day matrix, Today/Close; quick pills Bugun/Kecha (Today/Yesterday); mode badge "Jonli (Real-time)" vs archive; "Back to today" button; progress bar while loading. Choosing a past date reloads the active tab with `?date=YYYY-MM-DD` and **freezes live counters**. WS still patches presence fields only (`dashboard.js:2438-2494`) | `index.html:528-704`, `dashboard.js:12073-12515` (`loadDateData` 12444) |
| Live clock | HH:MM:SS, 1 s tick | `dashboard.js:468` |
| Presence widget | "N online" with a pulse dot. Popover lists every connected browser (username, role, PC name, IP, current tab, color, last active). Footer has a "Jonli kursorlar" (live cursors) toggle and "rename my PC" | `index.html:655-686`, `dashboard.js:1929-2104` |
| Multiplayer cursors | Every admin's mouse is broadcast (throttled 80 ms) and drawn as a colored arrow with a PC-name label on the same tab. Stale cursors are removed after 30 s. "Active tab" is negotiated across browser tabs through `localStorage` | `dashboard.js:2127-2372` |
| Right sidebar "Jonli Monitor" (live monitor) | Collapsible; state kept in `cc_sidebar_collapsed`. A floating "Monitor" edge button reopens it. Contents: (1) **Queue waiters** with count badge; (2) **Active conversations** (see §2.1); (3) **Callbacks** "Qayta bog'lanish kerak" (call back needed); (4) footer pills **AMI** and **SFTP** status plus a **Queue Info** button | `index.html:2574-2726` |
| Deploy watcher | Polls `/api/version` every 20 s, on focus and on `online`; also reacts to WS `server_version`. A new `buildId` shows a top banner "System updated" with an 8 s countdown auto-reload and a "pause" option | `dashboard.js:320-466` |
| Toasts | `showToast(msg, type)` with success / error / info colors | `dashboard.js:3077` |
| Page elevator | Floating button that scrolls up or down depending on direction and auto-hides | `dashboard.js:485-640`, `index.html:6333` |
| Tab-switch sound | Synthesized "page flip" (WebAudio noise and bandpass); fallback `/sounds/page-flip.wav` | `dashboard.js:789-875` |
| Esc key | Closes the gooey menu, section focus, KPI zoom, impersonation, profile and card-fields modals | `dashboard.js:15279-15304` |

### 2.1 Dashboard `/`

**Purpose:** live picture of today's call center (or of a chosen archive date).

| Block | Content | Data | Actions |
|---|---|---|---|
| KPI cards (8) `index.html:712-901` | Total calls; Inbound; Outbound (+% badge); Answered "Muvaffaqiyatli" (+answer rate); Abandoned "Navbatdan chiqdi" (left the queue, +rate); Queue waiting; Missed "O'tkazib yuborilgan"; Unique clients with a 5-way switch J/K/CH/O'/N (all / inbound / outbound / missed / abandoned). Each card has a "Mijozlar: N ta" (clients) sub-line | `stats_update`, `initial_state.stats`; fallback `GET /api/stats[?date]` | Click → drill-down modal `openCallsDetail(type)` (§2.7). Queue card → `openQueueDetail()`. Client card switch → `setClientKpiSwitch` |
| "Qo'ng'iroqlar Dinamikasi" (call dynamics) chart | Chart.js line chart, 08:00–21:00 hourly; series **Jami Kiruvchi** (total inbound, `#6366f1`) and **Javob berilgan** (answered, `#10b981`) | `stats.hourlyChart` (`dashboard.js:3427`) | — |
| Distribution chart | 5 slices: Muvaffaqiyatli `#10b981`, Kutilmoqda (pending) `#f59e0b`, Ulanilmadi (unreachable) `#f43f5e`, Chiquvchi (outbound) `#a855f7`, Gaplashildi (talked) `#38bdf8`. **3D Highcharts pie** or a **custom SVG 2D donut** with legend and animated numbers. Basis switch: **Mijozlar vs Qo'ng'iroqlar** (clients vs calls) | `stats` | Mode stored in `pie_chart_mode`, basis in `distribution_type` (`dashboard.js:1288-1426`) |
| Operators section `index.html:1053-1143` | Group tabs **Asosiy (100–199) / Zangiota (200+) / Barchasi** (all) with counts; summary "N suhbatda / N kutmoqda / N oflayn" (talking / waiting / offline); "Qatorlar" density toggle; operator cards grid with skeleton placeholders | `operators_update`, `initial_state.operators`, `/api/operators[?date]` | Click card → operator drill-down (`openOperatorDetail`). Group stored in `callcenter_op_group` |
| Operator card (`dashboard.js:6252-6420`) | Avatar = ext number; name with **rank badge** (MVP / #2 … #5 by total); "Exten N · IP"; state pill (Kutmoqda / Jiringlamoqda / Hozir suhbatda / Pauzada / Oflayn = waiting / ringing / talking / paused / offline); **call strip**: talking shows caller number, saved client name/org and a **live stopwatch** (`data-talking-since`, 1 s tick, yellow at ≥3 min, red pulse at ≥7 min, `dashboard.js:5633-5670`); ringing shows a pink "Incoming…" strip with the number; paused and offline show idle text. Then total calls, stacked bar (inbound / outbound / missed), stats (Kiruvchi, Chiquvchi, Transfer in/out, talk time, avg). "Next in line" highlight (predicted next operator in the queue). FLIP re-order animation; offline cards can be collapsed (`dashboard_offline_compact`) | — | Ext-114 avatar opens the hidden **Blacklist** tool (§7) |
| "So'nggi qo'ng'iroqlar" (recent calls) table `index.html:1145-1251` | Segment filter **Hammasi / Javobsiz / Navbatdan chiqdi / Transfer** (all / unanswered / left queue / transfer); search by operator or number with a datalist of operators; clear filter. Sortable columns: **Vaqt, Raqam, Operator, Davomiyligi, Kutish, Holat, Amal** (time, number, operator, duration, wait, status, action). Client-side pagination | `initial_state.callHistory`, `call_history_sync`, `call_hangup` (prepends a live row), `/api/calls/recent[?date]` | Row: copy number; **play inline** (`playDashboardRecording`: finds the recording via `GET /api/recordings/fast-find?callerId&duration`, fallback `GET /api/calls/details?search=`; button toggles play/pause/resume); **open in Explorer Studio** (switches to `/explorer` and plays in the big player) |
| Sidebar: Queue waiters | List of callers waiting, with position and queue name. Callers also merged from conversations that have no operator | `queue_update`, `initial_state.queues` | Click KPI → queue modal |
| Sidebar: Active conversations (`dashboard.js:4915-5170`) | Rows keyed by channel. **Swipe-out animation** when a call ends (800 ms). Tag talking / waiting / outbound; mobile-carrier badge from the number prefix (Beeline, Ucell, Uztelecom…, `dashboard.js:4852`); **live duration stopwatch** (1 s ticker, `dashboard.js:5154`); accordion expand per row (open key preserved across re-renders) | `active_conversations_update` (+ client sends `{action:'refresh_channels'}` every 5 s, `dashboard.js:176`) | Click number → copy. **Transfer** → modal with operator select (ready first) → `POST /api/action/transfer {channel, …}`. **Hangup** → `POST /api/action/hangup {channel}` |
| Sidebar: Callbacks (`dashboard.js:2593-3060`) | Date seg **Bugun / Hammasi** (today / all); chips **Kutilmoqda / Ulanilmadi / Gaplashildi** (pending / unreachable / talked) with counts; card shows number, contact name, attempts "N marta" (N times), relative time, IVR source badge, the operator currently talking to that number (live link with conversations), the last outbound operator and its attempts | `callbacks_update`, `initial_state.callbacks`, `GET /api/callbacks` | Copy number; delete one `DELETE /api/callbacks/:id` (custom confirm dialog); **clear all** `DELETE /api/callbacks`; **re-check** `POST /api/callbacks/sync` |
| Sidebar footer | AMI / SFTP connection pills | `ami_status`, `sftp_status`, WS open/close | **Queue Info** modal (§2.7) |

### 2.2 Operators `/operators` (3CX Desktop Agent view)

| Block | Content | Data | Actions |
|---|---|---|---|
| Header toolbar `index.html:1546-1578` | Card fields settings; A-Z sort toggle (`tabOperatorSortMode`); **CDR sync** button; "Last sync: 21:00" badge (auto sync nightly) | `GET /api/agent/sync-status` | CDR sync → `POST /api/agent/sync-from-cdr {date}` (`dashboard.js:10975`) |
| Agent operator cards `tabOperatorsGrid` | Per operator: Exten, accepted, outbound, grand total, total talk, Desktop Agent active / inactive, desktop host name | `GET /api/agent/operator-stats[?date]`, WS `agent_operators_update` | Click → filters the logs table to that operator |
| Agent call-log table | Operator select; columns **№, Qayd Vaqti, Operator, Mijoz Raqami, Hodisa Turi, Suhbat Vaqti** (record time, operator, client number, event type, talk time). Event labels: answered, denied/deny, outbound dialled, outbound unconnected | `GET /api/agent/logs?page&limit&date[&operatorId]` | Pagination |
| Chart "Operatorlar bo'yicha Qo'ng'iroqlar Taqsimoti" (calls per operator) | Chart.js grouped bar: Qabul qilingan `#10b981`, Chiquvchi `#38bdf8`, O'tkazib yuborilgan `#f59e0b` (answered, outbound, missed) | Same as cards (`dashboard.js:11766`) | — |
| "Tizim Kabinetlari (Adminka)" link cards | EDO cabinet (external link), Uzcrypto download `GET /api/tools/uzcrypto/download` + EDO welcome, E-Huquqshunos cabinet | Static | External links |
| Export (header button) | Date-range modal (presets today / 7 days / this month / previous month, custom range calendar) → choice modal: language **uz/ru**, group **all / main / secondary** | — | `GET /api/export/excel?startDate&endDate&group&lang` (XLSX download) (`dashboard.js:11447`) |

### 2.3 Call history `/history`

| Block | Content | Data | Actions |
|---|---|---|---|
| Toolbar `index.html:1780-1927` | **Date range** button (opens the audio-range modal); source switch **Agent (3CX)** vs **Server (Issabel)**; search (number, operator); filters **Holat** (answered / missed), **Yo'nalish** (inbound / outbound / transfer), **STT** (has text / none); clear; **column visibility** dropdown (persisted `callcenter_history_columns`) | — | — |
| Selection bar (Explorer style) | "N ta tanlandi" (N selected), "N ta audio mavjud" (N have audio); **Batch STT**; **Download selected (.zip)**; **Download whole page**; cancel | — | ZIP: `POST /api/recordings/zip-jobs {files, zipName}`, then poll `GET /api/recordings/zip-jobs/:id` → `…/download`; cancel `POST …/cancel`. A floating **ZIP progress toast** shows files and MB |
| Table `index.html:1979-2026` | Columns: ☐, №, **Vaqt, Mijoz Raqami, Operator/Exten, Yo'nalish, Davomiyligi, Navbatda kutish, Holati, Kim tugatdi?, Kompyuter (Host), Audio/Amal** (time, client number, operator/ext, direction, duration, queue wait, status, who hung up, host PC, audio/action). **Expandable caller cell**: long caller strings are truncated to 25 chars with an expand/collapse chevron; state is shared across tables (`dashboard.js:7639-7735`) | Agent: `GET /api/agent/logs?page&limit=20&date&search`. Server: `GET /api/history?page&limit=20&search&date[&direction&status&speaker]` (`dashboard.js:6869-6945`). `date` = `today`, `YYYY-MM-DD`, `all` or `start_end` | Row: play inline, open in Explorer Studio, **STT transcript** modal. Pagination with page numbers |
| Live behavior | WS `call_hangup` prepends a row when on page 1 with no search; silent refresh every 12 s under the same conditions (`dashboard.js:6857`) | — | — |

### 2.4 Audio Explorer `/explorer`

| Block | Content | Data | Actions |
|---|---|---|---|
| "Studio" player `index.html:1275-1415` | Hidden until something plays. Disc art, file name, status line, **Download**, close. **Waveform canvas** with two-speaker color legend (Operator / Mijoz = client), hover time tooltip, click or drag seek, keyboard on the canvas. Volume slider + mute; restart; **−10 s / +10 s**; play/pause; loop; speed pills **0.75 / 1 / 1.25 / 1.5 / 2×** | `GET /api/recordings/stream?file=…[&download=1]` | — |
| Global audio shortcuts (`dashboard.js:3778-3849`) | Active whenever audio is loaded and focus is not in an input: **←/→ ±5 s (Shift ±10 s), Space play/pause, ↑/↓ volume ±5 %**. A skip toast appears | — | — |
| Explorer toolbar | Back / Forward / Up / Refresh (**Alt+←, Alt+→, Alt+↑, Backspace = up**, `dashboard.js:3904-3925`); breadcrumb "root (monitor)"; search by number or file name | — | — |
| Folder grid | Date-structured folders with meta | `GET /api/recordings/tree?path=` | Click → navigate |
| Files table | **Fayl Nomi, Turi, Hajmi, Davomiyligi, Sana/Vaqt, Amallar** (file name, type, size, duration, date/time, actions). Type badge from a heuristic: empty 44-byte WAV / "Robot (queue only)" / "Human talk" (`dashboard.js:4114`) | same | Play (empty files show an alert); download link |

### 2.5 Clients `/clients`

| Block | Content | Data | Actions |
|---|---|---|---|
| Header | Total-clients badge; Refresh; **Add client** | `GET /api/contacts` | — |
| "Eng Faol Mijozlar" (top callers) grid | Top 8 by call count with speaking-language badge | `GET /api/contacts/top-active?limit=8` | Card actions as in the table |
| Search + language pills | Free text (name, phone, org, note, language); pills **All / uz / ru / en / other / not set** | client-side | — |
| Table | **№, Mijoz (Ism/Raqam), Tashkilot/Hudud, So'zlashuv Tili, Oxirgi Muloqot, Izoh, Amallar** (client name/number, organisation/region, speaking language, last contact, note, actions) | `GET /api/contacts`, WS `client_contacts_update` (live merge) | Edit / Add → client modal; Delete → `DELETE /api/contacts/:phone`; Telegram open; "call history" button (**broken**, §9) |
| Client modal `index.html:5132-5344` | Phone*, name, org/region, **Telegram ID or @username** (buttons: open via phone, open via ID, copy), language select, notes; Delete inside the modal | — | Save `POST /api/contacts` (on phone change: delete the old record first) |

Saved contact names also show **everywhere a number is shown**: operator call strips, conversations, callbacks, tables (`getClientContact`, `dashboard.js:7093-7160`).

### 2.6 Statistics `/statistics` (topic analytics, voice-to-text)

| Block | Content | Data | Actions |
|---|---|---|---|
| Filters | Period **Kun / Oy / Yil** (day / month / year); date, year and month selects (years from data); Refresh; **"Tahlil qilish"** (run analysis) | `GET /api/analytics/topics/dates` | Run → `POST /api/analytics/topics/analyze` |
| 4 KPI cards | **Kalit uzaytirish** (E-imzo / ERI key renewal), **EDO**, **E-Huquqshunos**, **Boshqa** (other): count, %, average duration | `GET /api/analytics/topics/summary?…` | — |
| Donut "Murojaatlar ulushi" (share of requests) | Highcharts pie: kalit `#38bdf8`, edo `#10b981`, ehuquq `#a855f7`, other `#f59e0b` | summary | — |
| Trend | Highcharts **areaspline ↔ column** toggle; 4 series per topic over days or months | `GET /api/analytics/topics/trend?…` | `setTopicTrendChartType` |
| Calls by topic table | Search (number, operator, text) debounced; topic pills; columns **Vaqt, Mijoz, Davomiyligi, Aniqlangan Mavzu, Matn parchasi, Operator** (time, client, duration, detected topic, text snippet, operator); pagination | `GET /api/analytics/topics/calls?…` | — |

### 2.7 Admin modals and overlays (cross-tab)

| Modal | Opened from | Content and actions | Endpoints |
|---|---|---|---|
| Drill-down detail `index.html:2841` | KPI cards, operator cards | Optional operator summary pills (accepted / missed / denied / …, category filter, **Pause / Unpause operator** button when the interface setting is on); search; per-page 50/100/200/500; pager; sortable columns **№, Vaqt, Mijoz Raqami, Yo'nalish, Operator, Davomiyligi/Kutish, Holati, Kim tugatdi?, Audio**. Esc closes | `GET /api/calls/details?type&operator&page&limit&search&date`; pause `POST /api/operator/pause {extension, paused}` |
| Queue detail | Queue KPI | Current waiters (from WS state) | — |
| **Queue Info** "Navbat hisobi" (queue counts, fewestcalls) `index.html:2733-2789` | Sidebar footer | Group seg (main / 200+ / all), filter all / active, **next operator** prediction, legend by state, editable per-operator **callsTaken** (click number, ±1, Enter saves, Esc cancels); "DB sync" toggle and "sync now"; live | `GET/POST /api/queue/sync-settings`, `POST /api/queue/sync-now`, `POST /api/queue/adjust-calls {operatorId, delta \| value, reset}` |
| Transfer `index.html:2792` | Conversation row | Select an operator (ready ones first, with state icons) | `POST /api/action/transfer` |
| STT transcript `index.html:2929-3122` | History / recent rows | Audio player; loading state "Wav2Vec2 Uzbek…"; tabs **cleaned / raw**; stats; "from cache" badge; edit, save, cancel; **AI re-process (Gemini)**; copy; learned-dictionary counter. A background **STT progress toast** can be clicked or cancelled | `POST /api/recordings/transcribe`, `GET …/transcribe/stats`, `POST …/transcribe/save`, `POST …/transcribe/reprocess` |
| Batch STT `index.html:3125-3279` | History selection | Counts total / cached / pending, total duration, "skip cached"; progress bar; per-row queue; Start / Stop; copy all; download .txt | `POST /api/recordings/transcribe/check-batch`, then sequential `POST /api/recordings/transcribe` |
| Audio date range "Ovozlarni Yuklab Olish" (download recordings) `index.html:3753-3985` | History "Sana oralig'i" (date range) | Presets, start/end, range calendar, operator/number filter; **"Jadvalda ko'rish"** applies the range to the history table; **Download ZIP** with live progress and cancel | `POST /api/recordings/zip-jobs {startDate,endDate,search,zipName}` + polling |
| Export → choice | Operators tab | See §2.2 | `/api/export/excel` |
| Server status `index.html:4954-5129` | Gooey menu | KPIs: PM2, PID, uptime, Node version; CPU and RAM gauges; physical disk and partitions (root + PBX audio disk); services list; **Proxmox VMs** with start/stop, **auto-recover** toggle, "power-outage recovery" (LVM fix + start VMs) with logs; auto-refresh every 5 s while open | `GET /api/system/status`, `GET /api/system/vms`, `GET/POST /api/system/vms/auto-recover`, `POST /api/system/vms/recover`, `POST /api/system/vms/:vmid/:action` |
| Anti-DDoS "Security Analytics" `index.html:4775-4952` | Profile menu, Settings | Counters: total, passed, blocked, jailed IPs, active WS; Chart.js live line (passed vs blocked); events table with **Unjail**; refresh every 2.5 s; **"Test Flood (Simulation)"** | `GET /api/security/stats`, `POST /api/security/unjail {ip}`, `POST /api/security/simulate-flood` |
| Settings "Tizim Sozlamalari" `index.html:5381-5766` | Profile menu | Tabs: **Xavfsizlik** (security: lockout threshold slider 3–10, duration 15 min–24 h, blocked list, unlock one or all); **Exclude list** (operators excluded from stats; searchable checkboxes); **Foydalanuvchilar RBAC** (users: create with username, password, role, operator ext, Gmail; table **Foydalanuvchi, Roli, Operator ID, Gmail, Yaratilgan, Amallar** = user, role, operator id, Gmail, created, actions; reset password, delete); **Faol sessiyalar** (active sessions: user, IP, **token**, UA, login time, revoke); **Interfeys** (interface: per-browser toggle "Pause button on operator cards") | `GET/POST /api/settings/security`, `GET /api/settings/lockouts`, `POST /api/settings/unlock {key}`, `POST /api/settings/unlock-all`, `GET/POST /api/settings/exclude-list {excluded}`, `GET/POST /api/settings/users`, `DELETE /api/settings/users/:u`, `PUT /api/settings/users/:u/password {password, revokePasskeys}`, `GET /api/settings/sessions`, `DELETE /api/settings/sessions/:id` |
| Admin reset password `index.html:5908` | Users table | New password (≥6); checkbox "revoke all passkeys" | `PUT …/password` |
| Profile & Gmail `index.html:5976-6205` | Profile menu | Current account; current password required; Gmail input with **live validation and typo suggestion**; **2-step flow with 6-digit code and 120 s timer**, resend; **unlink**; changing an already-bound email verifies the old one first (`bind_new` / `unlink_current` / `unlinking_only` steps) | `POST /api/auth/profile/email/send-code {email,password}` or `{action:'unlink',password}`; `POST /api/auth/profile/email/verify {email,code,step,targetNewEmail}` |
| Operator card fields | Operators tab / dashboard | Checkbox list of card rows; all on / all off / reset; persisted `callcenter_op_card_fields` | — |
| Custom confirm | Deletes | Dark glass confirm; Esc cancels | — |

### 2.8 Operator portal `/` (port 3005)

| Block | Content | Data | Actions |
|---|---|---|---|
| Header `viewer/public/index.html:1129-1159` | Logo; **uz/ru spring-animated pill toggle**; live clock; **profile badge** (name and Gmail dot) → profile modal; Logout | `client_identity` (WS) → name, role, operator id | Logout `POST /api/auth/logout` → redirect to the returned 3535 login URL |
| Callbacks panel `…:1164-1219` (operators: **read-only**) | Today / All pills; tabs **Kutilmoqda (Yangi) / Bog'lanib bo'lmadi / Gaplashildi** (pending (new) / could not reach / talked) with counts and a hint line; responsive grid with **expand / collapse** ("show more" by grid column count) and a "resolved today only" toggle | WS `callbacks_update`, `initial_state.callbacks`; fallback `GET /api/callbacks` | Copy number; add or edit contact; open Telegram |
| Operators panel `…:1221-1281` | Group tabs main / Zangiota / all (persisted `callcenter_viewer_op_group`); **"Saytda faol" (online now) presence pills** of everyone with the page open; superuser-only **Tarix** (history) button | WS `operators_update` / `agent_operators_update` / `active_conversations_update`; `GET /api/operators`; presence `active_viewers_update`, `GET /api/viewers/active` | — |
| Viewer operator card (`viewer.js:777-1431`) | "Mockup" redesign: avatar and ext, name, rank wreath (diamond/gold/silver/bronze), state, active-talk header with caller number and **saved client name**, **live stopwatch** (`viewer.js:389-425`), progress bar, stats. Sort: rank and presence priority (`viewer.js:631`); FLIP animation | — | Click → operator detail (no audio for operators); **bell → help request** to that operator; **PC button → RustDesk modal**; add/edit contact for the caller on the strip |
| Tools zones (drag & drop) `…:1284-1684` | Three zones: **Adminkalar** (admin cabinets), **Asosiy vositalar** (primary), **Kerakli vositalar** (secondary). Cards can be dragged between zones; layout persisted `callcenter_viewer_tools_layout_v1`; empty-zone placeholders and counters. Cards: EDO cabinet, E-Huquqshunos cabinet, Operator manual, AnyDesk cleaner (.bat download), Managers & E-XAT (`/tools/managers.html`), Universal file converter, Uzcrypto (version badge from `GET /api/tools/uzcrypto/latest`), Telegram Form dashboard, Ijro ERI letter generator (external), New Uzbek alphabet 2026, 3CX Softphone v6 (.msi + setup guide), **3CX Desktop Agent** ("my agent .zip" per operator + all-operators list) | static + `/downloads/...` | "Ochish" (open) = new tab; "Shu yerda ochish" (open here) = **iframe or image modal** with zoom (+/−, reset, Ctrl+wheel), "open in new window" |
| Converter modal `…:1881-2002` | Dropzone (PDF, DOCX, DOC, TXT, JPG, PNG, WEBP ≤ 35 MB) → target-format pills → progress → download; images are converted in the browser, documents on the server; "zero-storage" note | — | `POST /api/converter/convert {fileData(base64), …}` |
| Detail modal `…:1725` | Same as admin drill-down, without audio | `GET /api/calls/details?type=operator&operator=…` | — |
| Contact modal `…:1779` | Phone, name, org, Telegram id or @username (open button), language, notes; delete | `POST /api/contacts`, `DELETE /api/contacts/:phone` | — |
| **Operator help request** (`viewer.js:3436-4060`) | Outgoing modal: **voice (push-to-talk, max 15 s, needs HTTPS for the microphone; a banner offers a switch link)** or **text (300 chars, quick chips)** or a **silent direct ring**; a "calling…" state with cancel. Incoming modal: glowing ring icon, text and/or voice playback, **Accept "Yordam beraman (OK)"** (I'll help) / **Reject "Hozir bandman"** (busy now). Repeating chime (WebAudio, every 1.6 s), accept and reject tones, **tab-title blink**, **desktop Notification**. If the portal does not know who you are, a "Siz qaysi operatorsiz?" (which operator are you?) picker appears | WS: send `help_request`, `help_cancel`, `help_response`; receive `incoming_help_request`, `help_request_status`, `help_response_received`, `help_cancelled` | — |
| Viewer access history (superuser) `…:2240-2298` | Search; filter all / online / offline; columns **Holati, Foydalanuvchi/Operator, Roli, IP, Kirgan, Chiqqan, Davomiyligi** (status, user/operator, role, IP, logged in, logged out, duration) | `GET /api/viewers/history` | Refresh |
| Remote desktop (RustDesk) `…:2909-2976` | Operator card info, LAN IP (auto-detected, editable, copy, re-detect), RustDesk-installed indicator | `GET /api/remote-desktop/devices`, WS `rustdesk_device_status`; `POST /api/remote-desktop/toggle-device`, `POST /api/remote-desktop/notify-operator` | **Connect** → `rustdesk://<ip>` deep link |
| 3CX agents list / 3CX setup guide / Operator manual | Tools cards | Agents grid with filter (all, 100+, 200+) and search, plus a universal `custom.zip`; SIP parameter table (PBX IP); manual with tabs: focus tree (`/data/tree.json`), greeting standard, transfer and internal numbers, Telegram form, breaks and discipline, tech support | static | — |
| Ticket sidebar `…:2301-2378` | Floating toggle with a red badge; right-docked sidebar: sound toggle, "open full screen" (`/tickets.html`), **"Yangi Ticket Ochish"** (open new ticket; creators only), filter tabs **Barchasi / Menga or "Men yaratgan" / Yangi / Jarayonda / Bajarildi / Rad etilgan** (all / to me or "created by me" / new / in progress / done / rejected) with counts; mini cards | see §2.9 | — |
| Profile & Gmail `…:2815-2906` | Same 6-digit flow as admin (no password step); the passkey manager is mounted only if `#passkey-manager` exists (true on `/tickets`, not on `/`) | `/api/auth/profile/email/send-code`, `/verify` | — |
| Resilience | WS reconnect with backoff 2 s → ×1.5 → 30 s; **6 s fallback polling** while WS is down; **45 s silence watchdog** (server pings every 15 s); re-sync on `visibilitychange`; `session_terminated` or close code 4001 → alert and go to login (`viewer.js:4585-4760`) | — | — |

### 2.9 Tickets `/tickets` (full-page "KDS board") and sidebar

| Block | Content | Data / actions |
|---|---|---|
| Header `viewer/public/tickets.html:170-205` | Back to the operator panel; title; sound toggle (`ticket_sound_enabled`); "Yangi Ticket Ochish" (creators only); clock; profile badge; logout | — |
| Cleanup notice | "Completed tickets auto-purged every Monday" + manual **clean** button | `POST /api/tickets/cleanup` |
| Filter tabs + grid | Same filters as the sidebar; large cards; horizontal wheel-scroll on strips; tip about Ctrl+V screenshots | `GET /api/tickets?filter=…&operatorId=…` (`tickets.js:265`) |
| Create modal | Creator (fixed to the current 200+ operator on the full page; a hardcoded select of 200-ext operators in the sidebar version); **target operator** (all, or a specific 100–199 operator; hardcoded list); client phone; **urgent toggle** (urgent = loud alert to all); comment*; **attachments**: dropzone, file picker or **Ctrl+V paste**, image/PDF/DOC/DOCX, preview strip | `POST /api/tickets` |
| Ticket box (detail) | Id badge and status; reject notice; meta (creator, time, accepted by, client phone, target); description; screenshot gallery; **internal chat replies** with attachments (Ctrl+V); actions by status: pending → Accept / Reject; in_progress → Complete / Reject; rejected → re-accept; creator: Edit / Delete | `PUT /api/tickets/:id` (or `POST /:id/edit`), `POST /:id/accept`, `/complete`, `/reject {reason}`, `/comments`, `DELETE /:id` |
| Reject modal | Preset reasons (5 chips) + required free text | — |
| Document viewer | In-place full-screen viewer for image, PDF and Word (**mammoth.js** renders DOCX client-side; legacy DOC via `POST /api/tickets/preview-doc`); download; new tab; Esc | — |
| Realtime | WS events `ticket_created` (toast, chime, **urgent variant**, title flash; only to assignees or superuser, not the creator), `ticket_accepted/completed/rejected/updated`, `ticket_comment_added` (chime), `ticket_deleted`, `tickets_cleaned`, `client_identity` (`tickets.js:1752-1830`) | — |

### 2.10 Standalone pages

| Page | Purpose | Notable |
|---|---|---|
| `public/guide.html` (= `viewer/public/guide.html`) | "Tizimlar va Rollar Daraxti" (systems and roles tree): interactive focus tree from `/data/tree.json`; click centers a node and expands its roles | Zoom +/−/reset, center, toggle hint boxes, "collapse all" |
| `public/tools/managers.html` (viewer copy differs only in animations) | Reference directory of responsible staff: tabs **Toshkent (13) / Vazirliklar (7) / Viloyatlar (14) / E-XAT** (Tashkent, ministries, regions, E-XAT); search; copy phone with a toast; font scale A−/A+; print | Data hardcoded in JS arrays (`managers.html:619-870`) |
| `viewer/public/tools/uzb2026.html` | New Uzbek Latin keyboard (ş ç ğ ö ʼ): download, character map with copy, playground with quick insert and copy, 4-step install guide | Download link points to a file that does not exist (§9) |

---

## 3. Real-time contract

### 3.1 WebSocket messages consumed (server → client)

| Type | Admin | Viewer | Tickets | Effect |
|---|---|---|---|---|
| `initial_state` | ✓ | ✓ (relayed, `serverVersion` stripped) | | Bootstrap: `amiStatus`, `sftpStatus`, `stats`, `conversations`, `queues`, `operators`, `callHistory`, `callbacks`, `contacts`, `clientId`, `serverVersion` |
| `stats_update` | ✓ | | | KPIs and charts (ignored in archive mode) |
| `active_conversations_update` | ✓ | ✓ | | Sidebar conversations; operator call strips; callbacks re-render |
| `queue_update` | ✓ | | | Queue waiters |
| `operators_update` | ✓ | ✓ | | Operator cards (archive mode: presence fields only) |
| `agent_operators_update` | ✓ | ✓ | | Operators tab cards / viewer cards |
| `call_hangup` | ✓ | | | Prepend a recent-calls row; live history row |
| `call_history_sync` | ✓ | | | Replace the recent-calls list |
| `callbacks_update` | ✓ | ✓ | | Callbacks panels |
| `client_contacts_update` | ✓ | ✓ | | Contact cache merge (names on every number) |
| `excluded_operators_update` | ✓ | | | Exclude-list cache |
| `ami_status`, `sftp_status` | ✓ | | | Footer pills |
| `agent_ota_log` | ✓ | | | OTA log list in the (unreachable) agent settings modal |
| `server_version` | ✓ | ✓ (own `buildId`) | | Deploy banner |
| `client_assigned`, `presence_stats`, `remote_cursor_move`, `remote_cursor_remove` | ✓ | | | Presence count and list, cursors |
| `client_identity` | | ✓ | ✓ | IP, role, username, operator id and name, `operatorLocked` |
| `active_viewers_update` | | ✓ | | "Saytda faol" pills |
| `incoming_help_request`, `help_request_status`, `help_response_received`, `help_cancelled` | | ✓ | | Help-request modals and sounds |
| `remote_install_prompt`, `rustdesk_device_status` | | ✓ | | RustDesk state |
| `server_ping` | | ✓ | | Watchdog keep-alive (ignored) |
| `session_terminated` (+ close 4001) | | ✓ | | Force logout after a password change |
| `ticket_*`, `tickets_cleaned` | | ✓ (sidebar) | ✓ | Ticket board |

### 3.2 Client → server WS messages

| Message | Sender | When |
|---|---|---|
| `{action:'refresh_channels'}` | Admin | Every 5 s (`dashboard.js:176`) |
| `{action:'sync'}` | Admin | `#btnSync` (no such button in the current HTML) |
| `{type:'presence_ping', appType:'dashboard_3535', deviceId, tabId, isActiveTab, isVisible, pcName, tab, username, role}` | Admin | On open and every 10 s |
| `{type:'cursor_move', deviceId, tabId, xRatio, contentY, tab, pcName}` / `{type:'cursor_leave'}` | Admin | Mouse move (80 ms throttle) / mouseleave |
| `{type:'register_operator', data:{operatorId, operatorName}}` | Viewer | On connect and on identity change |
| `help_request` / `help_cancel` / `help_response` | Viewer | Help flow |

### 3.3 Timers and polling

| Timer | Interval | Where |
|---|---|---|
| Conversation stopwatches | 1 s (skipped when the document is hidden) | `dashboard.js:5154` |
| Operator "talking since" stopwatches (3 / 7 min color thresholds) | 1 s | `dashboard.js:5633-5670`, `viewer.js:389-425` |
| Header and calendar clocks | 1 s | `dashboard.js:468`, `12183`; `viewer.js:2424` |
| Stats fallback poll (only when WS is down and on today) | 5 s | `dashboard.js:3450` |
| History silent refresh (page 1, no search) | 12 s | `dashboard.js:6857` |
| Deploy version check | 20 s + focus + online | `dashboard.js:320`, `viewer.js:5709` |
| Server-status modal refresh | 5 s while open | `dashboard.js:12523` |
| Security modal refresh | 2.5 s while open | `dashboard.js:16505` |
| ZIP job polling | `zipJobPollInterval` | `dashboard.js:9466` |
| Email-code countdown | 1 s for 120 s | `dashboard.js:15047`, `viewer.js:2923` |
| Viewer fallback polling (`/api/operators`, `/api/viewers/active`, `/api/callbacks`) | 6 s while WS is down | `viewer.js:103` |
| Viewer WS watchdog | Checks every 10 s, kills after 45 s of silence | `viewer.js:4728` |
| Presence heartbeat / cursor GC | 10 s / 30 s staleness | `dashboard.js:2222` |

---

## 4. Login and auth flows

| Flow | Behavior | Endpoints / anchors |
|---|---|---|
| Password login (`login.html:1690-1780`) | Split card: left is an **animated character stage** (characters cover their eyes when the password field is focused, peek, react to error or success; `login.html:984-1124`); right is a form with floating labels, show-password toggle, shake on error, button morph (spinner → green check) and slide-out transition | `POST /api/auth/login {username,password}` → sets the `cc_session` cookie (7 days, HttpOnly, SameSite=Lax), returns `{user:{username,role}, token}`. 401 bad credentials, **429 lockout** (`app.js:386-407`) |
| Post-login redirect | On 3535 with `admin`/`superuser`: **panel-choice modal** (Admin 3535 or Operators 3005). `operator` → `https://host:3005/?token=…`. Others → `/` | `login.html:1738-1760`, `2166-2195` |
| Passkeys (WebAuthn) | Button "Barmoq izi bilan tezkor kirish" (quick fingerprint login); needs HTTPS (explains when not secure); uses `@simplewebauthn/browser` (`/vendor/simplewebauthn-browser.js`) and `window.Passkey` (`public/js/passkey-client.js`). After a password login the viewer offers enrollment ("Ha, ulash / Keyinroq / Boshqa so'ramang" = yes connect / later / don't ask again; remembered in localStorage). Enrollment needs the current password and a device name. Manager (list, delete) mounts in the profile modal where `#passkey-manager` exists | `POST /api/auth/webauthn/login-options`, `/login-verify`, `/register-options` (auth), `/register-verify`, `/passkeys/list`, `/passkeys/delete` (`services/webauthnService.js:563-575`) |
| Forgot password (3-step modal, `login.html:1254-1440`, `1790-2200`) | 1) login or email → if the account has no email, a fallback email field appears; 2) 6-digit code, **120 s countdown**, attempts warning ("more than 3 wrong → blocked"), resend; 3) new password + confirm (≥6) → auto-login and redirect (operator → 3005) | `POST /api/auth/forgot-password/request {identifier,email}`, `/verify`, `/reset {username, resetToken, newPassword}` |
| Gmail binding (logged in) | §2.7 Profile & Gmail (admin needs the current password; viewer variant without) | `/api/auth/profile/email/send-code`, `/verify` |
| Change own password | Endpoint exists (`POST /api/auth/change-password`, `app.js:437`), **no UI** | — |
| Logout | Admin: `POST /api/auth/logout`, clears `auth_token` and sessionStorage, goes to `/login`. Viewer: same endpoint on 3005, then redirect to the 3535 login | `dashboard.js:6`, `viewer.js:22` |
| 3535 ↔ 3005 hops | Admin → "Operatorlar Paneli (3005)" (`switchToViewerPanel`, `dashboard.js:16711`) appends `?token=` from localStorage or the cookie. The viewer converts `?token=` into its cookie (`viewer/app.js:373-381`). The 3535 server never reads `?token` (cookie or Bearer only). Operators reaching any 3535 page are 302'd to 3005 | — |
| Token handling | Server session in the **HttpOnly cookie** `cc_session` (the viewer also clears `cc_viewer_session`). The client **additionally** writes the token to `localStorage` keys `cc_token`, `auth_token`, `viewer_token` (`login.html:1734`, `2184-2186`) for cross-port hops; the session-tokens table in Settings shows raw tokens | — |
| Session invalidation | An admin password reset calls the internal `POST /api/internal/invalidate-sessions` on 3005, which sends `session_terminated` and closes with 4001 | `viewer/app.js:293-327` |

**Rewrite recommendations:** serve the SPA from one origin with the cookie only. Drop `?token=` URLs and localStorage token copies. Keep the panel choice as a role-aware landing route (`/admin` vs `/operator`).

---

## 5. i18n, theme and visual style

### 5.1 i18n
- Languages: **uz** (default, Latin) and **ru** (`public/js/i18n.js:1-4`). The language is stored in `localStorage.callcenter_lang`; switching fires `window` event `languageChanged`.
- Organization: one JS object `I18N_TRANSLATIONS = { uz:{…}, ru:{…} }` with flat snake_case keys grouped by comments (nav, date filter, KPIs, charts, history, settings…). The DOM is translated through `data-i18n`, `data-i18n-placeholder`, `data-i18n-title` (and `data-i18n-html="true"`). JS uses `t(key, fallback)` and `tf(key, params, fallback)` with `{name}` interpolation (`i18n.js:1464-1500`).
- Size: admin **~626 unique keys per language** (644 entries; about 18 duplicate keys); viewer **~200 keys** (`viewer/public/js/i18n.js`). `dashboard.js` calls `t()` with ~293 distinct keys, **~130 of which are missing from the dictionary** and render only their inline Uzbek fallback. `index.html` has 275 `data-i18n` attributes; viewer index has 66.
- Not translated at all (hardcoded Uzbek): `login.html`, `tickets.html`/`tickets.js`, `guide.html`, `tools/*.html`, most modal bodies (server status, security, settings, profile), toasts and alerts.
- Excel export has its own uz/ru language choice (server-side).

### 5.2 Theme and look
- **Dark-only.** The single `prefers-color-scheme: light` rule touches only the music player (`public/css/style.css:5388`). No theme switcher. Selects are forced dark (`index.html:197-212`).
- Core tokens (`public/css/style.css:5-57`): background `#0b0f19` / `#111827`, cards `#131d31` (hover `#1a2742`), sidebar `#0f172a`, border `rgba(255,255,255,.08)`; primary indigo `#6366f1`, secondary cyan `#06b6d4`, accent `#6c8cff`; success `#10b981`, warning `#f59e0b`, danger `#ef4444`; text `#f8fafc` / muted `#94a3b8` / dim `#64748b`; radii 8 / 12 / 16 / 20; sidebar width 385 px; motion easings (`--ease-out`, `--ease-spring`, `--ease-drawer`) and durations 140 / 220 / 280 ms.
- Operator-card palette (`style.css:2690-2701`): `--op-bg #0b1120`, `--op-panel #121a2e`, `--op-live #3ea6ff`, `--op-ok #34d6a0`, `--op-wait #ffb547`, `--op-off #ff6e6e`; ringing pink `#ec4899`.
- KPI card accents (border and label color): blue `#60a5fa`, cyan `#22d3ee`, purple `#c084fc`, green `#34d399`, amber `#fbbf24`, indigo `#818cf8`, red `#f87171` (`index.html:168-194`). KPI icons are PNGs in `public/images/*.png`.
- Style vocabulary: "glass" panels (`.glass-panel`, translucent dark with blur), glowing pulse dots, pill segmented controls, skeleton loaders, FLIP re-order and swipe-out animations, modals with fade or scale close (`smoothCloseDashboardModal`).
- Fonts: self-hosted `public/fonts/fonts.css` + `font-1..11.woff2` — **Inter** and **Golos Text**, weights 400–800, Cyrillic, Cyrillic-ext, Latin and Latin-ext subsets. `--font-family` is overridden to put Golos Text first (`style.css:117`). The viewer index still loads the same families from **Google Fonts** (`viewer/public/index.html:12-14`). A few stray families (Onest, Schibsted Grotesk) appear in later CSS blocks.
- Icons: **Iconsax (Linear)**. Inline helper `isax(name)` with ~45 path definitions (`public/js/iconsax.js`) plus a sprite `/icons/iconsax/iconsax-sprite.svg#isax-*`, colored with `currentColor`. Brand icons: `edo-*.svg`, `e-huquqshunos-logo.svg`, `uzcrypto.png`, favicon `/images/title-icon.png`. Many emoji are used as icons in labels.
- CSS size: `public/css/style.css` 11k lines; `viewer/public/css/style.css` 6k lines + `tickets.css` 2.5k. Huge inline `style=""` usage in HTML.

---

## 6. Charts

Libraries are vendored locally: **Chart.js** (`/vendor/chart.min.js`), **Highcharts** + **highcharts-3d** (`/vendor/highcharts*.js`). WaveSurfer was removed (`index.html:19-21`). The waveform is a custom canvas.

| Chart | Library / type | Series and colors | Anchor |
|---|---|---|---|
| Call dynamics (dashboard) | Chart.js `line`, filled, tension 0.35 | Jami Kiruvchi `#6366f1`, Javob berilgan `#10b981`; hourly 08–21 | `dashboard.js:914` |
| Distribution 3D | Highcharts `pie` with `options3d` (alpha 45) | 5 slices (see §2.1) | `dashboard.js:983` |
| Distribution 2D | Custom SVG donut + legend (not a library) | Same 5 slices | `dashboard.js:1572`, `index.html:959-1050` |
| Calls per operator (Operators tab) | Chart.js `bar` | Qabul qilingan `#10b981`, Chiquvchi `#38bdf8`, O'tkazib yuborilgan `#f59e0b` | `dashboard.js:1083`, `11766` |
| Topic share (Statistics) | Highcharts `pie` | kalit `#38bdf8`, EDO `#10b981`, E-Huquqshunos `#a855f7`, other `#f59e0b` | `dashboard.js:15937` |
| Topic trend (Statistics) | Highcharts `areaspline` ↔ `column` | Same 4 topics | `dashboard.js:16032` |
| Security traffic | Chart.js `line` | Passed `#10b981`, Blocked `#ef4444` | `dashboard.js:16578` |
| Server status gauges, operator stacked bars, viewer progress bars | CSS / SVG | — | `index.html:5021-5068` |
| Audio waveform | Canvas, **synthetic**: pseudo-random bars seeded from file name and size, not decoded audio | Two-speaker coloring | `dashboard.js:4301-4497` |

The viewer pages load Chart.js and Highcharts vendor files, but `viewer.js` and `tickets.js` create **no charts**.

---

## 7. Experimental, dev-only or dead features (for the product owner)

| # | Feature | Status / evidence | Suggested decision input |
|---|---|---|---|
| 1 | **Visual AI Inspector** (Lovable/v0-style "click-to-prompt"): Ctrl/Alt/Cmd+Shift+D; select elements or draw areas, attach screenshots, send prompts to `/api/dev/visual-prompt` → "Antigravity inbox" (`npm run bridge`) | Loaded on every page (`index.html:6350`, viewer, guide, managers). Gated to superuser/admin/localhost + `localStorage.cc_dev_inspector='1'` + server `ENABLE_DEV_INBOX` (`public/js/visualInspector.js:1-90`) | Dev tooling. Drop from production |
| 2 | **Multiplayer cursors + presence list** (Figma-style) | Live, admin only. Broadcasts every admin's mouse position | Keep the presence list ("who is online, which tab")? Cursors are novelty |
| 3 | **Simulate flood** button in Anti-DDoS modal | Sends 60 fake requests from a random IP (`dashboard.js:16696`) | Dev/demo. Drop |
| 4 | **Impersonation (Ctrl+;)**: admin version | Only writes `sessionStorage.impersonated_operator`, which nothing reads; "manual token" writes `localStorage.auth_token`, which the server ignores (`dashboard.js:15310-15375`) | Non-functional on 3535 |
| 5 | **Impersonation (Ctrl+;)**: viewer/tickets version | Real "login as": pulls live session tokens (superuser only, via `/api/settings/sessions`) and writes another user's `cc_session` cookie (`tickets.js:2380-2440`) | Security-sensitive. Replace with a proper audited "view as" or drop |
| 6 | Session tokens shown in Settings → Sessions table | Raw tokens visible to admins (`index.html:5711-5729`) | Show masked ids only |
| 7 | **Guide / manual pages** (`guide.html` focus tree, viewer "Operator manual" modal, 3CX setup guide) | Static content; `tree.json` driven | Content product decision; could become CMS/markdown pages |
| 8 | **Hidden Blacklist manager**: click the ext-114 operator avatar → password modal → list/add/delete numbers | `public/js/blacklist.js`; auth = shared password sent as `x-blacklist-auth`, cached in sessionStorage (`blacklist.js:717-840`, `app.js:3369`) | Easter-egg UX. Make it a normal admin screen with RBAC |
| 9 | Universal file converter in the admin SPA | Logic present (`dashboard.js:15408-15745`) but **no markup** in `index.html`; `/converter` and `/tools` routes land on Statistics | Converter exists only in the viewer modal |
| 10 | 3CX Agent settings / OTA release modal (`agentSettingsModal`, "publish new version") | Markup `index.html:3440-3584` and JS `dashboard.js:11932-12072`, **no opener** in the UI | Dead. Decide if OTA release UI is needed |
| 11 | 3CX Agent logs modal (`agentLogsModal`) | Markup `index.html:3357` and `openAgentLogsModal` exist; never opened | Dead (superseded by the Operators tab table) |
| 12 | Admin Remote Desktop (RustDesk) modal | Markup `index.html:4150-4238`; no `openRemoteDesktopModal`/`connectRustDeskAction` in `dashboard.js` | Dead on admin (works in viewer) |
| 13 | Section focus / KPI parent zoom | `toggleSectionFocus`, `toggleKpiParentZoom` defined (`dashboard.js:13372-13498`), no trigger | Dead |
| 14 | Star rating and wreath badge generators | `generateStarRatingHtml` and several wreath SVG helpers unused; only rank chips are rendered | Gamification. Decide |
| 15 | Viewer speed test (`openSpeedtestModal`) and RustDesk install prompt | JS present (`viewer.js:6417-6726`), **`#speedtestModal` and `#rustdeskInstallPromptModal` missing** from HTML | Dead |
| 16 | Viewer client directory modal | Markup `viewer/public/index.html:2005`, `openClientDirectoryModal` never invoked | Dead |
| 17 | `switchToAdminDashboard` (viewer → 3535) | Defined, no button (`viewer.js:2830`) | Admins use the login panel choice instead |
| 18 | Explorer audio category filter (`currentAudioCategory` all/talk/robot) | State only, no UI (`dashboard.js:26`) | Dead |
| 19 | Easter-egg / person-specific code | Hardcoded username and email checks for one admin user (`dashboard.js:2013`, `viewer.js:2248`, `tickets.js:908`) | Remove; use RBAC |
| 20 | Telegram Form dashboard, Ijro ERI letter generator, AnyDesk cleaner, Uzcrypto, 3CX downloads | External/utility tools linked from the viewer | Keep as a configurable "links/tools" registry |
| 21 | Page-flip tab sound, gooey menu, animated login characters | Pure UX flourish | Optional |
| 22 | **Next.js "architecture map"** (`legacy/src`) | See below | Internal visualization; not product UI |

**`legacy/src` (Next.js) in one paragraph.** A small, separate Next.js 16 / React 19 app (`npm run map:dev|map:build|map:start`). It is not wired into either Express server. `/` redirects to `/architecture-map` (`src/app/page.tsx`), a client-only page that renders a **3D force-directed graph** of the system (react-force-graph-3d / three.js, loaded with `ssr:false`). Nodes and edges come from a static dataset in `src/data/architecture.ts`, grouped into clusters telefoniya (Issabel/Asterisk), backend, db, frontend, external and infra. Supporting components: `FilterBar` (cluster filters), `HudTooltip` (node details), `StatusBar`, and `ArchitectureGraph`. It is a developer/onboarding visualization and contains no call-center functionality.

---

## 8. UX details worth keeping (checklist)

- Live **stopwatches** on conversations and on talking operators, with 3 min (warning) and 7 min (danger, pulsing) thresholds.
- **Swipe-out** of finished calls; **FLIP** re-ordering of operator cards; skeleton placeholders.
- **"Next in line"** operator highlight; rank chips (MVP, #2–#5).
- **Expandable caller cells** (25-char truncate + chevron, state shared across tables).
- Saved **client name/org shown next to every phone number** (live via WS); click-to-copy numbers with feedback.
- Mobile-carrier badge derived from the number prefix.
- **Archive mode** from the global date filter (live counters frozen; presence still live) with a "Back to today" shortcut.
- Audio: one shared `<audio>` element; inline play/pause/resume per row; "open in Studio" hand-off that resumes at the same position; global shortcuts (←/→ ±5 s, Shift ±10 s, Space, ↑/↓ volume); speed pills; loop; download.
- Explorer keyboard navigation (Alt+arrows, Backspace).
- History: column visibility, multi-select with ZIP/batch-STT action bar, background job **progress toasts** with cancel.
- Callbacks: today/all + 3 status chips with counts, attempt counters, relative times, live link to an ongoing call.
- Queue Info: inline-editable callsTaken with ±, Enter/Esc.
- Deploy banner with an 8 s countdown and cancel.
- Viewer: drag-and-drop tool zones with persisted layout; iframe/image "open here" modal with zoom; help request with push-to-talk, text chips, ringtone loop, title blink, desktop notification.
- Tickets: Ctrl+V screenshot paste, urgent alert sound, in-place PDF/DOCX viewer, reject reasons presets.
- Esc closes modals everywhere; Enter submits code inputs; 6-digit code inputs use `inputmode=numeric` + `autocomplete=one-time-code`.
- Persisted UI preferences (localStorage): `callcenter_lang`, `cc_sidebar_collapsed`, `callcenter_op_group`, `callcenter_viewer_op_group`, `callcenter_op_card_fields`, `callcenter_history_columns`, `pie_chart_mode`, `distribution_type`, `dashboard_offline_compact`, `tabOperatorSortMode`, `setting_show_operator_pause`, `multiplayer_*`, `callcenter_viewer_tools_layout_v1`, `ticket_sound_enabled`, `viewer_my_operator_id/name`.

---

## 9. Parity gaps and bugs found while reading (do not port)

| Issue | Evidence |
|---|---|
| "Call history" button in the clients table calls the undefined `openClientCallHistory` | `dashboard.js:7278`, `7391` |
| Duplicate element id `modalOpCardFields` (two modals) | `index.html:5836`, `6208` |
| Pre-render route map lacks `/converter`, `/asboblar`, `/customers`, `/mijozlar` (brief flash to dashboard) | `index.html:29` vs `dashboard.js:648-667` |
| Hardcoded operator lists (ext and names) in HTML selects and impersonation presets | `index.html:3392-3400`, `viewer/public/index.html:2402-2427`, `tickets.js:2390-2398` |
| `uzb2026.html` downloads `/downloads/uzb2026-setup.zip`, but the file is `uzb2026-klaviatura.zip` | `viewer/public/tools/uzb2026.html:451`, `public/downloads/` |
| Passkey manager not available on viewer `/` (script and `#passkey-manager` only on `/tickets`) | `viewer/public/index.html:3383-3394` |
| ~130 i18n keys used in code with no dictionary entry | §5.1 |
| `#btnSync` handler wired but no button exists | `dashboard.js:1828-1835` |
| Client-side role decisions from usernames and localStorage (spoofable UI gating) | §1.3 |
